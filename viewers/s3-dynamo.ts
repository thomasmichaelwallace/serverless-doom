/* eslint-env browser */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Credentials } from 'aws-lambda';
import { KeyCodes, KeyEvent } from '../lib/common/doom';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

type DoomClientOptions = {
  bucketName: string;
  tableName: string;
  credentials: Credentials
  img: HTMLImageElement;
};

class DoomClient {
  static DOOM_FRAMES_PER_SECOND = 5;

  DOOM_FRAME_KEY: string;

  DOOM_BUCKET_NAME: string;

  DOOM_KEY_DB_TABLE_NAME: string;

  s3: S3Client;

  img: HTMLImageElement;

  ddb: DynamoDBDocumentClient;

  constructor({
    bucketName,
    tableName,
    credentials,
    img,
  }: DoomClientOptions) {
    const config = { region: 'eu-west-1', credentials };

    this.s3 = new S3Client(config);
    this.DOOM_BUCKET_NAME = bucketName;
    this.DOOM_FRAME_KEY = 'doom-frame.png';
    this.img = img;

    this.ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config));
    this.DOOM_KEY_DB_TABLE_NAME = tableName;

    window.addEventListener('keydown', (e) => this.handleKey(e, KeyEvent.KeyDown));
    window.addEventListener('keyup', (e) => this.handleKey(e, KeyEvent.KeyUp));
  }

  handleKey(event: KeyboardEvent, type: KeyEvent) {
    if (event.repeat) return;
    const doomMap: Record<string, keyof typeof KeyCodes> = {
      Enter: 'Enter',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      Control: 'Ctrl',
      ' ': 'Space',
      Alt: 'Alt',
    };
    const keyCode = doomMap[event.key];
    if (keyCode) {
      const command = new PutCommand({
        Item: {
          ts: performance.now(),
          event: type,
          keyCode,
        },
        TableName: this.DOOM_KEY_DB_TABLE_NAME,
      });
      this.ddb.send(command).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('Failed to save key', e);
      });
    }

    event.preventDefault();
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

  async step(): Promise<void> {
    const frameIn = performance.now();
    await this.updateImage();
    const timeToWait = (1000 / DoomClient.DOOM_FRAMES_PER_SECOND) - (performance.now() - frameIn);
    if (timeToWait > 0) {
      await delay(timeToWait);
    } else {
    // eslint-disable-next-line no-console
      console.warn(`Frame took ${-timeToWait}ms too long`);
    }
    return this.step();
  }
}

function main() {
  const client = new DoomClient({
    credentials: {
      accessKeyId: jsonCredentials.Credentials.AccessKeyId,
      secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
      sessionToken: jsonCredentials.Credentials.SessionToken,
    },
    bucketName: context.doomBucketName,
    tableName: context.doomKeyDbTableName,
    img: document.getElementById('doom-frame') as HTMLImageElement,
  });
  // eslint-disable-next-line no-console
  client.step().catch((e) => { console.error(e); });
}
main();
