/* eslint-env browser */

/* eslint-disable no-console */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Doom from '../lib/common/doom';
import { fromSaveCode, getSaveCode } from '../lib/common/payload';
import toDoomKey from '../lib/common/toDoomKey';
import { DoomWindow, KeyEvent } from '../lib/common/types';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

const credentials = {
  accessKeyId: jsonCredentials.Credentials.AccessKeyId,
  secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
  sessionToken: jsonCredentials.Credentials.SessionToken,
};
const config = { region: 'eu-west-1', credentials };
const s3 = new S3Client(config);

let PENDING_RESTORE = false;
let PENDING_DUMP = false;
let PENDING_DUMP_TO_S3 = false;

async function main() {
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const doom = new Doom();

  const doDump = async () => {
    const dump = new Uint8Array(doom.memory.buffer, 0, doom.memory.buffer.byteLength);
    const code = await getSaveCode(dump);
    console.log('-- saveKey > --');
    console.log(code);
    console.log('-- < saveKey --');
    (window as unknown as DoomWindow).savedState = code;

    if (PENDING_DUMP_TO_S3) {
      const command = new PutObjectCommand({
        Bucket: context.doomBucketName,
        Key: 'doom-state-key',
        Body: code,
      });
      const response = await s3.send(command);
      console.log('saved', response);
    }
    PENDING_DUMP_TO_S3 = false;
  };

  const dumpGameButton = document.getElementById('doom-dump') as HTMLAnchorElement;
  dumpGameButton.onclick = () => {
    PENDING_DUMP = true;
  };

  const restore = async () => {
    const saveKey = (window as unknown as DoomWindow).savedState;
    if (saveKey === undefined) {
      console.warn('window.saveKey must be set');
      return;
    }
    const dump = await fromSaveCode(saveKey);
    if (doom.memory.buffer.byteLength < dump.length) {
      console.warn('doom.memory.buffer is too small');
      const delta = (dump.length - doom.memory.buffer.byteLength) / 65536; // in 64k pages
      console.log('growing doom.memory.buffer by', delta, 'pages');
      doom.memory.grow(Math.ceil(delta));
    }

    const memory = new Uint8Array(doom.memory.buffer, 0, dump.length);
    memory.set(dump);
    console.log('recovered', dump.length);
  };

  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = () => {
    PENDING_RESTORE = true;
  };

  const s3RecoverGameButton = document.getElementById('doom-s3-recover') as HTMLAnchorElement;
  s3RecoverGameButton.onclick = async () => {
    const command = new GetObjectCommand({
      Bucket: context.doomBucketName,
      Key: 'doom-state-key',
    });
    const response = await s3.send(command);
    (window as unknown as DoomWindow).savedState = await response.Body?.transformToString();
    console.log('recovered', ((window as unknown as DoomWindow).savedState || '').length);
    PENDING_RESTORE = true;
  };

  const s3DumpGameButton = document.getElementById('doom-s3-dump') as HTMLAnchorElement;
  s3DumpGameButton.onclick = () => {
    PENDING_DUMP = true;
    PENDING_DUMP_TO_S3 = true;
  };

  doom.onStep = async () => {
    console.log('step');
    if (PENDING_RESTORE) {
      await restore();
      PENDING_RESTORE = false;
    }
    if (PENDING_DUMP) {
      await doDump();
      PENDING_DUMP = false;
    }
  };

  doom.updateScreen = (img) => {
    console.log('updateScreen');
    const data = new ImageData(
      img,
      Doom.DOOM_SCREEN_WIDTH,
      Doom.DOOM_SCREEN_HEIGHT,
    );
    ctx.putImageData(data, 0, 0);
  };

  const handleKey = (event: KeyboardEvent, type: KeyEvent) => {
    const key = toDoomKey(event, type);
    if (!key) return;

    if (key.event === KeyEvent.KeyDown) {
      doom.sendKeyDown(key.keyCode);
    } else {
      doom.sendKeyUp(key.keyCode);
    }
  };

  window.addEventListener('keydown', (e) => handleKey(e, KeyEvent.KeyDown));
  window.addEventListener('keyup', (e) => handleKey(e, KeyEvent.KeyUp));

  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  await doom.start(doomWasm as BufferSource);
}

main().catch((e) => { console.error(e); });
