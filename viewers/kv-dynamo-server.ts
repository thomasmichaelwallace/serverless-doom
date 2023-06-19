/* eslint-disable no-console */
import Doom from '../lib/common/doom';
import startMaster from '../lib/common/kvsMaster';
import type { AwsCredentials } from '../lib/common/types';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

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

  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  const jsonCredentials = await fetch('./credentials.json').then((r) => r.json() as unknown as AwsCredentials);
  const awaitDoom = doom.start(doomWasm as BufferSource);

  const awaitStream = startMaster({
    ...jsonCredentials,
    channelName: 'tom-test-channel',
    natTraversalDisabled: false,
    forceTURN: true,
    useTrickleICE: true,
    localStream: canvas.captureStream(),
  });

  return Promise.all([awaitDoom, awaitStream]);
}
main().catch((e) => { console.error(e); });
