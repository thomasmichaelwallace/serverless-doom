/* eslint-disable no-console */
import * as fs from 'fs';
import puppeteer from 'puppeteer';
import localFileServer from '../lib/common/localFileServer';
import jsonCredentials from '../tmp/credentials.json';

const SERVER_BASE = './dist';

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
  page.on('console', (msg) => console.log('[page]', msg.text()));
  const canvasSelector = `#${canvasId}`;
  await page.waitForSelector(canvasSelector);
  await page.click(canvasSelector); // start doom!
  await page.screenshot({ path: 'tmp/doom.png' });

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
      fs.writeFileSync('./tmp/doom.mp4', video);
    });
    await page.evaluate(async (url) => { await fetch(url); }, blobUrl);
  }, 15 * 1000);

  return browser;
}

async function main() {
  console.log('[chrome] spawning puppeteer');
  const url = await localFileServer({
    serveDir: SERVER_BASE,
    jsonCredentials,
  });
  const localDoomPage = `${url}/kv-doom-server.html`;
  console.log('[chrome] url', localDoomPage);
  const doomOptions: PuppetDoomOptions = {
    localDoomPage,
    canvasId: 'doom-frame',
  };
  await puppetDoom(doomOptions);
}
main().catch((e) => { console.error(e); process.exit(1); });
