/* eslint-disable no-console */
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { CliTmpCredentials } from './types';

type LocalServerOptions = {
  serveDir: string;
  jsonCredentials: CliTmpCredentials;
};

export default async function localFileServer({
  serveDir,
  jsonCredentials,
}: LocalServerOptions): Promise<string> {
  console.log('[server]: starting local file server', serveDir);
  const server = http.createServer((request, response) => {
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
    filePath = path.join(serveDir, filePath);

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
      console.log('[server] running at ', url);
      resolve(url);
    });
  });
}
