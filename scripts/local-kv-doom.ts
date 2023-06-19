/* eslint-disable no-console */
import puppeteer from 'puppeteer';
// import Doom from '../lib/lambda/doom';

type PuppetDoomOptions = {
  localDoomPage: string;
  canvasId: string;
};

async function puppetDoom({
  localDoomPage,
  canvasId,
}: PuppetDoomOptions) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(localDoomPage);
  await page.setViewport({ width: 1080, height: 1024 });
  const canvasSelector = `#${canvasId}`;
  await page.waitForSelector(canvasSelector);
  await page.click(canvasSelector); // start doom!
  return browser;
}

async function main() {
  console.log('[chrome] spawning puppeteer');
  const doomOptions: PuppetDoomOptions = {
    localDoomPage: 'http://localhost:8000/kv-doom-server.html',
    canvasId: 'doom-frame',
  };
  await puppetDoom(doomOptions);
}
main().catch((e) => { console.error(e); process.exit(1); });
