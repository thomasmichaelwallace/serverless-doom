/* eslint-disable no-console */
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
  return browser;
}

async function main() {
  console.log('[chrome] spawning puppeteer');
  const url = await localFileServer({
    serveDir: SERVER_BASE,
    jsonCredentials: {
      Credentials: {
        AccessKeyId: jsonCredentials.Credentials.AccessKeyId,
        SecretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
        SessionToken: jsonCredentials.Credentials.SessionToken,
      },
    },
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
