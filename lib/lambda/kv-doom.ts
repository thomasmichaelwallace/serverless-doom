/* eslint-disable no-console */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import chromium from '@sparticuz/chromium';
import { Handler } from 'aws-lambda';
import fs from 'fs';
import http from 'http';
import path from 'path';
import puppeteer, { Page } from 'puppeteer-core';

console.log('imported');

const s3 = new S3Client({});

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

const jsonCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
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

async function startLocalServer() {
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
  return new Promise<string>((resolve) => {
    let url = '';
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
      resolve(url);
    });
  });
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
  return browser;
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (_, context) => {
  console.log('[chrome] starting local server');
  const url = await startLocalServer();
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
