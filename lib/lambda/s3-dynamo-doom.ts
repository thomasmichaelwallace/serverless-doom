import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Handler } from 'aws-lambda';
import { PNGStream } from 'canvas';
import Doom from './doom';

const s3 = new S3Client({});

async function getDoomWasm() {
  const command = new GetObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key: process.env.DOOM_WASM_KEY,
  });
  const data = await s3.send(command);
  return data.Body?.transformToByteArray();
}

async function saveDoomFrame(data: PNGStream) {
  const command = new PutObjectCommand({
    Bucket: process.env.DOOM_BUCKET_NAME,
    Key: process.env.DOOM_FRAME_KEY,
    Body: data,
  });
  await s3.send(command);
}

// eslint-disable-next-line import/prefer-default-export
export const handler : Handler = async () => {
  const wasm = await getDoomWasm();
  if (!wasm) return { statusCode: 500, body: 'Failed to load Doom' };

  const doom = new Doom();
  const awaitable = doom.start(wasm);

  doom.onStep = async () => {
    const png = doom.canvas.createPNGStream();
    await saveDoomFrame(png);
  };

  await awaitable;
  return { statusCode: 200, body: 'Doomed' };
};
