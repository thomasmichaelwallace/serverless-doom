/* eslint-disable no-console */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Credentials } from 'aws-lambda';
import toDoomKey from '../lib/common/toDoomKey';
import { KeyEvent } from '../lib/common/types';
import { delay } from '../lib/common/utils';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';

type DoomClientOptions = {
  bucketName: string;
  tableName: string;
  credentials: Credentials
  img: HTMLImageElement;
};

class DoomClient {
  static DOOM_FRAMES_PER_SECOND = 10;

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
    const Item = toDoomKey(event, type);
    if (!Item) return;

    const command = new PutCommand({
      Item,
      TableName: this.DOOM_KEY_DB_TABLE_NAME,
    });
    this.ddb.send(command).catch((e) => {
      console.error('Failed to save key', e);
    });
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

  async updateImageCaches() {
    this.img.src = await this.getImageBase64();
  }

  async updateImage() {
    URL.revokeObjectURL(this.img.src); // revoke to prevent caching.
    const command = new GetObjectCommand({
      Bucket: this.DOOM_BUCKET_NAME,
      Key: this.DOOM_FRAME_KEY,
      ResponseCacheControl: 'no-cache',
    });
    const data = await this.s3.send(command);
    const bytes = await data.Body?.transformToByteArray();
    if (!bytes) return;
    const blob = new Blob([bytes], { type: 'image/png' });
    this.img.src = URL.createObjectURL(blob);
  }

  async step(): Promise<void> {
    const frameIn = performance.now();
    await this.updateImage();
    const timeToWait = (1000 / DoomClient.DOOM_FRAMES_PER_SECOND) - (performance.now() - frameIn);
    if (timeToWait > 0) {
      await delay(timeToWait);
    } else {
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
  client.step().catch((e) => { console.error(e); });
}
main();
