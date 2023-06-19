/* eslint-env browser */

/* eslint-disable no-console */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import Doom from '../lib/common/doom';
import toDoomKey from '../lib/common/toDoomKey';
import { DoomState, DoomWindow, KeyEvent } from '../lib/common/types';
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

let DUMP_TO_S3 = false;

async function main() {
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const doom = new Doom();

  doom.onSaveState = async (state) => {
    if (DUMP_TO_S3) {
      const command = new PutObjectCommand({
        Bucket: context.doomBucketName,
        Key: context.doomBucketStateKey,
        Body: JSON.stringify(state),
      });
      await s3.send(command);
      DUMP_TO_S3 = false;
    } else {
      (window as unknown as DoomWindow).savedState = state;
    }
  };

  const dumpGameButton = document.getElementById('doom-dump') as HTMLAnchorElement;
  dumpGameButton.onclick = () => { doom.requestSaveState(); };

  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = () => {
    const { savedState } = window as unknown as DoomWindow;
    if (!savedState) {
      console.warn('[local] no saved state');
      return;
    }
    doom.requestLoadState(savedState);
  };

  const s3RecoverGameButton = document.getElementById('doom-s3-recover') as HTMLAnchorElement;
  s3RecoverGameButton.onclick = async () => {
    const command = new GetObjectCommand({
      Bucket: context.doomBucketName,
      Key: context.doomBucketStateKey,
    });
    const response = await s3.send(command);
    const state = await response.Body?.transformToString();
    if (!state) {
      console.warn('[local] no saved state');
      return;
    }
    doom.requestLoadState(JSON.parse(state) as DoomState);
  };

  const s3DumpGameButton = document.getElementById('doom-s3-dump') as HTMLAnchorElement;
  s3DumpGameButton.onclick = () => {
    DUMP_TO_S3 = true;
    doom.requestSaveState();
  };

  doom.updateScreen = (img) => {
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
