/* eslint-disable no-console */
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import puppeteer, { Page } from 'puppeteer-core';
import localFileServer from '../common/localFileServer';
import { CliTmpCredentials, DoomWindow } from '../common/types';

const MAX_PLAYS = 3;

const lambda = new LambdaClient({});
const s3 = new S3Client({});

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

type LambdaEvent = {
  plays?: number;
  stateKey?: string;
};

const JSON_CREDENTIALS: CliTmpCredentials = {
  Credentials: {
    AccessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AWS_ACCESS_KEY_ID',
    SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'AWS_SECRET_ACCESS_KEY',
    SessionToken: process.env.AWS_SESSION_TOKEN,
  },
};
const SERVER_BASE = './dist';

type PuppetDoomOptions = {
  localDoomPage: string;
  canvasId: string;
  saveCode?: string,
};

async function puppetDoom({
  localDoomPage,
  canvasId,
  saveCode,
}: PuppetDoomOptions) {
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
  const page = await browser.newPage();
  await page.goto(localDoomPage);
  page.on('console', (msg) => console.log('[page]', msg.text()));
  await page.setViewport({ width: 1080, height: 1024 });
  const canvasSelector = `#${canvasId}`;
  await page.waitForSelector(canvasSelector);
  if (saveCode) {
    console.log('[chrome] setting saveCode');
    await page.evaluate(
      (code) => {
        console.log('[chrome] setting window.saveCode');
        (window as unknown as DoomWindow).savedState = code;
        console.log('[chrome] set window.saveCode', code.length);
      },
      saveCode,
    );
    console.log('[chrome] waiting for restore');
    const restore = await page.waitForSelector('#doom-recover');
    console.log('[chrome] clicking restore');
    await restore?.click();
  }
  await page.click(canvasSelector); // start doom!
  return page;
}

async function checkPoint(page: Page): Promise<string | false> {
  console.log('[chrome] checkPoint', 'checking point');
  const dump = await page.waitForSelector('#doom-dump');
  console.log('[chrome] clicking!', dump);
  await dump?.click();
  await delay(1000); // pending; give loop a chance!
  console.log('[chrome] delay.!');
  const saveCode = await page.evaluate(() => {
    console.log('[chrome] getting window');
    const savecode = (window as unknown as DoomWindow).savedState;
    return savecode || '';
  });
  console.log('[chrome] got saveCode', saveCode.length);
  let stateKey: string | false = false;
  if (saveCode.length > 0) {
    console.log('[chrome] saving to s3');
    stateKey = 'doom-state-key';
    const command = new PutObjectCommand({
      Bucket: process.env.DOOM_BUCKET_NAME,
      Key: stateKey,
      Body: saveCode,
    });
    await s3.send(command);
  }
  await page.click('#doom-quit');
  console.log('[chrome] quit');
  page.browser().process()?.kill();
  console.log('[chrome] close.!');
  return stateKey;
}

async function startNext(options: {
  functionName: string,
  plays: number,
  stateKey?: string,
}) {
  console.log('[chrome] startNext');
  const event: LambdaEvent = {
    plays: options.plays + 1,
    stateKey: options.stateKey,
  };
  const command = new InvokeCommand({
    FunctionName: options.functionName,
    InvocationType: InvocationType.Event,
    Payload: Buffer.from(JSON.stringify(event)),
  });
  console.log('[chrome] startNext', 'invoking', options.functionName);
  await lambda.send(command);
}

async function getState(event: LambdaEvent): Promise<string | undefined> {
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
  return response.Body?.transformToString();
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (event: LambdaEvent, context) => {
  console.log('[chrome] handler', event);
  if (event?.plays && event.plays > MAX_PLAYS) {
    console.log('[chrome] max plays reached');
    return { statusCode: 200, body: 'Doomed' };
  }

  console.log('[chrome] starting local server');
  const { url, server } = await localFileServer({
    jsonCredentials: JSON_CREDENTIALS,
    serveDir: SERVER_BASE,
  });
  const localDoomPage = `${url}/kv-iot-server.html`;

  console.log('[chrome] spawning puppeteer');
  const doomOptions: PuppetDoomOptions = {
    localDoomPage,
    canvasId: 'doom-frame',
    saveCode: await getState(event),
  };
  const browser = await puppetDoom(doomOptions);

  const timeToPlay = Math.max(context.getRemainingTimeInMillis() - 4000);
  console.log(`Playing Doom for ${timeToPlay}ms`);

  await Promise.race([
    delay(timeToPlay).then(async () => {
      console.log('[chrome] time to play is up; check pointing');
      const stateKey = await checkPoint(browser);
      console.log('[chrome] checked point', stateKey);
      server.close();
      await startNext({
        functionName: context.functionName,
        plays: event.plays || 0,
        stateKey: stateKey === false ? undefined : stateKey,
      });
    }),
  ]);

  return { statusCode: 201, body: 'Doomed' };
};
