/* eslint-disable no-console */
import Doom, { KeyCodes, KeyEvent } from '../lib/common/doom';
import IotClient from '../lib/common/iotClient';
import startMaster from '../lib/common/kvsMaster';
import { fromSaveCode, getSaveCode } from '../lib/common/payload';
import type {
  AwsCredentials, CliTmpCredentials, DoomKey, DoomWindow,
} from '../lib/common/types';
import context from '../tmp/context.json';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

let PENDING_RESTORE = false;
let PENDING_DUMP = false;
// const PENDING_DUMP_TO_S3 = false;

async function main() {
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const doom = new Doom(ctx);
  doom.updateScreen = (img) => {
    const data = new ImageData(
      img,
      Doom.DOOM_SCREEN_WIDTH,
      Doom.DOOM_SCREEN_HEIGHT,
    );
    ctx.putImageData(data, 0, 0);
  };

  const doDump = async () => {
    const dump = new Uint8Array(doom.memory.buffer, 0, doom.memory.buffer.byteLength);
    const code = await getSaveCode(dump);
    console.log('-- saveKey > --');
    // console.log(code);
    console.log('-- < saveKey --');
    (window as unknown as DoomWindow).savedState = code;
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

  doom.onStep = async () => {
    if (PENDING_RESTORE) {
      await restore();
      PENDING_RESTORE = false;
    }
    if (PENDING_DUMP) {
      await doDump();
      PENDING_DUMP = false;
    }
  };

  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  const jsonCredentials = await fetch('./credentials.json').then((r) => r.json() as unknown as CliTmpCredentials);
  const awaitDoom = doom.start(doomWasm as BufferSource);

  const credentials: AwsCredentials = {
    accessKeyId: jsonCredentials.Credentials.AccessKeyId,
    secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
    sessionToken: jsonCredentials.Credentials.SessionToken,
  };

  const awaitStream = startMaster({
    ...credentials,
    channelName: context.kinesisChannelName,
    natTraversalDisabled: false,
    forceTURN: true,
    useTrickleICE: true,
    localStream: canvas.captureStream(),
  });

  const iot = new IotClient<DoomKey>({
    credentials,
    awsIotEndpoint: context.awsIotEndpoint,
    topic: context.iotTopic,
  });
  // eslint-disable-next-line @typescript-eslint/require-await
  iot.onMessage = async (k) => {
    const key = KeyCodes[k.keyCode];
    if (k.event === KeyEvent.KeyDown) {
      doom.keyDown(key);
    } else {
      doom.keyUp(key);
    }
  };

  const awaitIot = iot.connect();

  const dumpGameButton = document.getElementById('doom-dump') as HTMLAnchorElement;
  dumpGameButton.onclick = () => {
    // console.log('dump button clicked');
    // // await awaitDoom;
    // console.log('dumping...');
    // const dump = new Uint8Array(doom.memory.buffer, 0, doom.memory.buffer.byteLength);
    // console.log('dumping!');
    // const code = await getSaveCode(dump);
    // console.log('saving...');
    // console.log('-- saveCode > --');
    // // console.log(code);
    // (window as unknown as DoomWindow).savedState = code;
    // console.log('-- < saveCode --');
    PENDING_DUMP = true;
  };

  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = () => {
    // await awaitDoom;
    // const saveCode = (window as unknown DoomWindow).savedState;
    // if (saveCode === undefined) {
    //   console.warn('window.saveKey must be set');
    //   return;
    // }
    // const dump = await fromSaveCode(saveCode);
    // if (doom.memory.buffer.byteLength < dump.length) {
    //   console.warn('doom.memory.buffer is too small');
    //   const delta = (dump.length - doom.memory.buffer.byteLength) / 65536; // in 64k pages
    //   console.log('growing doom.memory.buffer by', delta, 'pages');
    //   doom.memory.grow(Math.ceil(delta));
    // }

    // const memory = new Uint8Array(doom.memory.buffer, 0, dump.length);
    // memory.set(dump);
    // console.log('recovered', dump.length);
    PENDING_RESTORE = true;
  };

  const doomQuitButton = document.getElementById('doom-quit') as HTMLAnchorElement;
  doomQuitButton.onclick = async () => {
    const stream = await awaitStream;
    // stream.signalingClient?.close();
    Object.entries(stream.peerConnectionByClientId).forEach(([i, pc]) => {
      console.log('closing', i, pc.localDescription);
      pc.close();
    });
  };

  await Promise.all([awaitDoom, awaitStream, awaitIot]);
}
main().catch((e) => { console.error(e); });
