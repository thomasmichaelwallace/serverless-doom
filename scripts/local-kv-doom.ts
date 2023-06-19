/* eslint-disable no-console */
import fs from 'fs';
import http from 'http';
import path from 'path';
import puppeteer from 'puppeteer';
import jsonCredentials from '../tmp/credentials.json';

const SERVER_BASE = './dist';

const server = http.createServer((request, response) => {
  console.log('request starting...');

  if (!request.url) {
    console.warn('[server]: 404');
    response.writeHead(404);
    response.end();
    return;
  }

  let filePath = request.url;
  if (filePath === '/') { filePath = '/index.html'; }
  if (filePath === '/credentials.json') {
    console.log('[server]: 200', 'credentials.json');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(jsonCredentials), 'utf-8');
    return;
  }
  filePath = path.join(SERVER_BASE, filePath);

  console.log('[server] request', filePath, request.url);

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    default:
      contentType = 'text/html';
      break;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        console.warn('[server]: 404', filePath);
        response.writeHead(404, { 'Content-Type': contentType });
        response.end('file not found', 'utf-8');
      }
    } else {
      console.log('[server]: 200', filePath);
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(content, 'utf-8');
    }
  });
});
let url = '';
const awaitServer = new Promise<void>((resolve) => {
  server.listen(8666, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'string') {
      url = address;
    } else if (address === null) {
      url = 'http://localhost:80';
    } else {
      url = address?.family === 'IPv6' ? `http://[${address.address}]:${address.port}` : `http://${address.address}:${address.port}`;
    }
    console.log('Server running at ', url);
  });
  resolve();
});

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
  await awaitServer;
  const localDoomPage = `${url}/kv-doom-server.html`;
  console.log('[chrome] url', localDoomPage);
  const doomOptions: PuppetDoomOptions = {
    localDoomPage,
    canvasId: 'doom-frame',
  };
  await puppetDoom(doomOptions);
}
main().catch((e) => { console.error(e); process.exit(1); });
