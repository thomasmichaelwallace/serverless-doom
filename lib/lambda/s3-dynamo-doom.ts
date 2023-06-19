import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Handler } from 'aws-lambda';
import Jimp from 'jimp';
import Doom from '../common/doom';
import { KeyEvent, type DoomKey } from '../common/types';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function getDoomWasm() {
  const command = new GetObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key: process.env.DOOM_WASM_KEY,
  });
  const data = await s3.send(command);
  return data.Body?.transformToByteArray();
}

async function saveDoomFrame(data: Buffer) {
  const command = new PutObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key: process.env.DOOM_FRAME_KEY,
    Body: data,
  });
  await s3.send(command);
}

async function getKeys() {
  const TableName = process.env.DOOM_KEY_DB_TABLE_NAME;
  const command = new ScanCommand({ TableName });
  const data = await ddb.send(command);
  data.Items?.sort((a, b) => a.ts - b.ts);
  await Promise.all((data.Items as DoomKey[] || []).map(async (i) => {
    const c = new DeleteCommand({ TableName, Key: { ts: i.ts } });
    await ddb.send(c);
  }));
  return (data.Items || []) as DoomKey[];
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async (_, context) => {
  const wasm = await getDoomWasm();
  if (!wasm) return { statusCode: 500, body: 'Failed to load Doom' };

  const screen = new Jimp(Doom.DOOM_SCREEN_WIDTH, Doom.DOOM_SCREEN_HEIGHT);
  const doom = new Doom(screen);
  doom.updateScreen = (data) => {
    doom.screen = new Jimp({
      data,
      width: Doom.DOOM_SCREEN_WIDTH,
      height: Doom.DOOM_SCREEN_HEIGHT,
    });
  };

  const fps = Number.parseInt(process.env.DOOM_FRAMES_PER_SECOND || '', 10);
  if (Number.isInteger(fps) && fps > 0) {
    doom.framesPerSecond = Math.min(fps, doom.framesPerSecond);
    // eslint-disable-next-line no-console
    console.log(`Setting FPS to ${doom.framesPerSecond}`);
  }

  doom.onStep = async () => {
    const keys = await getKeys();
    keys.forEach((k) => {
      if (k.event === KeyEvent.KeyDown) {
        doom.sendKeyDown(k.keyCode);
      } else {
        doom.sendKeyUp(k.keyCode);
      }
    });
    const png = await doom.screen.getBufferAsync('image/png');
    await saveDoomFrame(png);
  };

  const timeToPlay = Math.max(context.getRemainingTimeInMillis() - 1000);
  // eslint-disable-next-line no-console
  console.log(`Playing Doom for ${timeToPlay}ms`);

  await Promise.race([
    doom.start(wasm),
    delay(timeToPlay),
  ]);

  return { statusCode: 200, body: 'Doomed' };
};
