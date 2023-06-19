/* eslint-env browser */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Credentials } from 'aws-lambda';
import jsonCredentials from '../tmp/credentials.json';

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

type DoomClientOptions = {
  bucketName: string;
  credentials: Credentials
  img: HTMLImageElement;
};

class DoomClient {
  static DOOM_FRAMES_PER_SECOND = 1;

  DOOM_FRAME_KEY: string;

  DOOM_BUCKET_NAME: string;

  s3: S3Client;

  img: HTMLImageElement;

  constructor({
    bucketName,
    credentials,
    img,
  }: DoomClientOptions) {
    this.DOOM_BUCKET_NAME = bucketName;
    this.DOOM_FRAME_KEY = 'doom-frame.png';
    this.s3 = new S3Client({ region: 'eu-west-1', credentials });
    this.img = img;
  }

  async getImageBase64() {
    const command = new GetObjectCommand({
      Bucket: this.DOOM_BUCKET_NAME,
      Key: this.DOOM_FRAME_KEY,
      ResponseCacheControl: 'no-cache',
    });
    const data = await this.s3.send(command);
    const image = await data.Body?.transformToString('base64') || '';
    const mime = 'data:image/png;base64';
    return `${mime},${image}`;
  }

  async updateImage() {
    this.img.src = await this.getImageBase64();
  }

  async render(): Promise<void> {
    const frameIn = performance.now();
    await this.updateImage();
    const timeToWait = (1000 / DoomClient.DOOM_FRAMES_PER_SECOND) - (performance.now() - frameIn);
    if (timeToWait > 0) {
      await delay(timeToWait);
    } else {
    // eslint-disable-next-line no-console
      console.warn(`Frame took ${-timeToWait}ms too long`);
    }
    return this.render();
  }
}

function main() {
  const client = new DoomClient({
    credentials: jsonCredentials as Credentials,
    bucketName: 'serverlessdoomstack-doombucketb92c69dd-bzw4jpsnuvs2',
    img: document.getElementById('doom-frame') as HTMLImageElement,
  });
  // eslint-disable-next-line no-console
  client.render().catch((e) => { console.error(e); });
}
main();
