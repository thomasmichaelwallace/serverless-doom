/* eslint-disable no-console */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import puppeteer, { Page } from 'puppeteer-core';
import localFileServer from '../common/localFileServer';

console.log('imported');

const s3 = new S3Client({});

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

const JSON_CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AWS_ACCESS_KEY_ID',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'AWS_SECRET_ACCESS_KEY',
  sessionToken: process.env.AWS_SESSION_TOKEN,
};
const SERVER_BASE = './dist';

let photoCount = 0;
async function postPhoto(page: Page) {
  const image = await page.screenshot();
  photoCount += 1;
  const Key = `${process.env.DOOM_PHOTO_KEY || 'ss'}-${photoCount}.png`;
  const command = new PutObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key,
    Body: image,
  });
  console.log('postPhoto', Key);
  await s3.send(command);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  setTimeout(() => postPhoto(page), 2000);
}

type PuppetDoomOptions = {
  localDoomPage: string;
  canvasId: string;
};

async function puppetDoom({
  localDoomPage,
  canvasId,
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
  await page.click(canvasSelector); // start doom!
  await postPhoto(page);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  setTimeout(async () => {
    console.log('[page] downloading for video');
    await page.evaluate(() => {
      const a = document.querySelector('#download-doom-video') as HTMLAnchorElement;
      window.open(a.href);
    });
    const newTarget = await page.browserContext().waitForTarget(
      (target) => target.url().startsWith('blob:'),
    );
    const newPage = await newTarget.page();
    const blobUrl = newPage?.url() as string;
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    page.once('response', async (response) => {
      const video = await response.buffer();
      const Key = `${process.env.DOOM_PHOTO_KEY || 'ss'}-video.mp4`;
      const command = new PutObjectCommand({
        Bucket: process.env.DOOM_BUCKET_NAME,
        Key,
        Body: video,
      });
      console.log('postPhoto', Key);
      await s3.send(command);
    });
    await page.evaluate(async (url) => { await fetch(url); }, blobUrl);
  }, 15 * 1000);

  return browser;
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (_, context) => {
  console.log('[chrome] starting local server');
  const url = await localFileServer({
    jsonCredentials: JSON_CREDENTIALS,
    serveDir: SERVER_BASE,
  });
  const localDoomPage = `${url}/kv-doom-server.html`;
  console.log('[chrome] spawning puppeteer');
  const doomOptions: PuppetDoomOptions = {
    localDoomPage,
    canvasId: 'doom-frame',
  };
  await puppetDoom(doomOptions);

  const timeToPlay = Math.max(context.getRemainingTimeInMillis() - 1000);
  console.log(`Playing Doom for ${timeToPlay}ms`);

  await Promise.race([
    delay(timeToPlay),
  ]);

  return { statusCode: 200, body: 'Doomed' };
};
