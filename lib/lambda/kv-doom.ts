/* eslint-disable no-console */
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import puppeteer from 'puppeteer-core';

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

type PuppetDoomOptions = {
  localDoomPage: string;
  canvasId: string;
};

async function puppetDoom({
  localDoomPage,
  canvasId,
}: PuppetDoomOptions) {
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    defaultViewport: chromium.defaultViewport,
    args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
  });
  const page = await browser.newPage();
  await page.goto(localDoomPage);
  await page.setViewport({ width: 1080, height: 1024 });
  const canvasSelector = `#${canvasId}`;
  await page.waitForSelector(canvasSelector);
  await page.click(canvasSelector); // start doom!
  return browser;
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (_, context) => {
  console.log('[chrome] spawning puppeteer');
  const doomOptions: PuppetDoomOptions = {
    localDoomPage: 'http://localhost:8000/kv-doom-server.html',
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
