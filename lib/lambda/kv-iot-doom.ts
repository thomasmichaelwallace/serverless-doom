/* eslint-disable no-console */
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import puppeteer, { Page } from 'puppeteer-core';
import localFileServer from '../common/localFileServer';
import { CliTmpCredentials, DoomState, DoomWindow } from '../common/types';
import { delay } from '../common/utils';

const lambda = new LambdaClient({});
const s3 = new S3Client({});

type KvIotDoomEvent = {
  plays?: number;
  stateKey?: string;
};

// puppeteer

type PuppetDoomOptions = {
  localDoomPage: string;
  canvasId: string;
  savedState?: DoomState,
};
async function startPuppetDoom({
  localDoomPage,
  canvasId,
  savedState,
}: PuppetDoomOptions) {
  // start chrome
  console.log('[chrome] puppetDoom', 'getting chrome');
  const executablePath = await chromium.executablePath();
  console.log('[chrome] puppetDoom', executablePath);
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
  console.log('[chrome] puppetDoom', 'got chrome');

  // load doom worker
  const page = await browser.newPage();
  await page.goto(localDoomPage);
  await page.setViewport({ width: 1080, height: 1024 });
  const canvasSelector = `#${canvasId}`;
  await page.waitForSelector(canvasSelector);

  // log console
  page.on('console', (msg) => console.log('[page]', msg.text()));

  // restore state
  if (savedState) {
    console.log('[chrome] setting saveCode');
    await page.evaluate(
      (s) => {
        console.log('[chrome] setting window.savedState');
        (window as unknown as DoomWindow).savedState = s;
        console.log('[chrome] set window.savedState', s.timestamp, s.snapshot.length);
      },
      savedState,
    );
    console.log('[chrome] waiting for restore');
    const restore = await page.waitForSelector('#doom-recover');
    console.log('[chrome] clicking restore');
    await restore?.click();
  }

  await page.click(canvasSelector); // (ensure doom keeps focus)
  return page;
}

async function stopPuppetDoom(page: Page): Promise<string | false> {
  // request state save
  console.log('[chrome] checkPoint', 'checking point');
  const dump = await page.waitForSelector('#doom-dump');
  console.log('[chrome] clicking!', dump);
  await dump?.click();
  await delay(1000); // pending; give loop a chance!
  console.log('[chrome] delay.!');
  const savedState = await page.evaluate(() => {
    console.log('[chrome] getting window');
    return (window as unknown as DoomWindow).savedState;
  });

  // persist state to s3
  let stateKey: string | false = false;
  if (savedState) {
    console.log('[chrome] got window.savedState', savedState.timestamp, savedState.snapshot.length);
    stateKey = process.env.DOOM_STATE_KEY_PREFIX || 'doom-state-key';
    console.log('[chrome] saving to s3');
    const command = new PutObjectCommand({
      Bucket: process.env.DOOM_BUCKET_NAME,
      Key: stateKey,
      Body: JSON.stringify(savedState),
    });
    await s3.send(command);
  }

  // close channels and browser
  await page.click('#doom-quit');
  console.log('[chrome] quit streams');
  page.browser().process()?.kill(); // force quit required due to chrome bug
  console.log('[chrome] processed killed');
  return stateKey;
}

// aws interface (s3 + lambda)
async function getState(event: KvIotDoomEvent): Promise<DoomState | undefined> {
  console.log('[chrome] getState', event);
  if (!event.stateKey) {
    console.log('[chrome] getState', 'no stateKey');
    return undefined;
  }
  const command = new GetObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key: event.stateKey,
  });
  console.log('[chrome] getState', 'getting state');
  const response = await s3.send(command);
  console.log('[chrome] getState', 'got state');
  const json = await response.Body?.transformToString();
  if (!json) return undefined;
  return JSON.parse(json) as DoomState;
}

async function invokeNextPlay(options: {
  functionName: string,
  plays?: number,
  stateKey?: string,
}) {
  console.log('[chrome] invoke next');
  const event: KvIotDoomEvent = {
    plays: (options.plays || 0) + 1,
    stateKey: options.stateKey,
  };
  const command = new InvokeCommand({
    FunctionName: options.functionName,
    InvocationType: InvocationType.Event,
    Payload: Buffer.from(JSON.stringify(event)),
  });
  console.log('[chrome] invoking', options.functionName, event);
  await lambda.send(command);
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (event: KvIotDoomEvent, context) => {
  console.log('[lambda] handler', event);

  // prevent infinite loop
  let maxPlays = 3;
  const maxPlaysEnv = Number.parseInt(process.env.DOOM_MAX_PLAYS || '', 3);
  if (Number.isInteger(maxPlaysEnv) && maxPlaysEnv > 0) {
    maxPlays = maxPlaysEnv;
  }
  console.log(`[lambda] max plays: ${maxPlays}`);
  if (event?.plays && event.plays > maxPlays) {
    console.log('[lambda] max plays reached');
    return { statusCode: 200, body: 'Doomed' };
  }

  // local server
  console.log('[lambda] starting local server');
  const jsonCredentials: CliTmpCredentials = {
    Credentials: {
      AccessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AWS_ACCESS_KEY_ID',
      SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'AWS_SECRET_ACCESS_KEY',
      SessionToken: process.env.AWS_SESSION_TOKEN,
    },
  };
  const { url, server } = await localFileServer({
    jsonCredentials,
    serveDir: './dist',
  });
  const localDoomPage = `${url}/kv-iot-server.html`;

  // puppeteer
  console.log('[lambda] spawning puppeteer');
  const doomOptions: PuppetDoomOptions = {
    localDoomPage,
    canvasId: 'doom-frame',
    savedState: await getState(event),
  };
  const browser = await startPuppetDoom(doomOptions);

  // play doom
  const timeToPlay = Math.max(context.getRemainingTimeInMillis() - 4000);
  console.log(`[lambda] playing doom for ${timeToPlay}ms`);
  await delay(timeToPlay);

  // save state
  console.log('[lambda] time to play is up; check pointing');
  const stateKey = await stopPuppetDoom(browser);
  console.log('[chrome] checked point', stateKey);

  // start next
  await invokeNextPlay({
    functionName: context.functionName,
    plays: event.plays,
    stateKey: stateKey === false ? undefined : stateKey,
  });

  // close
  server.close();

  return { statusCode: 201, body: 'Keep dooming!' };
};
