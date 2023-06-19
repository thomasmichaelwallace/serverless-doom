/* eslint-disable no-console */
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import puppeteer from 'puppeteer-core';
import localFileServer from '../common/localFileServer';

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

const JSON_CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AWS_ACCESS_KEY_ID',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'AWS_SECRET_ACCESS_KEY',
  sessionToken: process.env.AWS_SESSION_TOKEN,
};
const SERVER_BASE = './dist';

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
