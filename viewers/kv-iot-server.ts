/* eslint-disable no-console */
import Doom from '../lib/common/doom';
import IotClient from '../lib/common/iotClient';
import startMaster from '../lib/common/kvsMaster';
import {
  KeyEvent, type AwsCredentials, type CliTmpCredentials, type DoomKey, type DoomWindow,
} from '../lib/common/types';
import context from '../tmp/context.json';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

async function main() {
  // configure aws
  const jsonCredentials = await fetch('./credentials.json').then((r) => r.json() as unknown as CliTmpCredentials);
  const credentials: AwsCredentials = {
    accessKeyId: jsonCredentials.Credentials.AccessKeyId,
    secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
    sessionToken: jsonCredentials.Credentials.SessionToken,
  };

  // get doom screen
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // start doom
  const doom = new Doom();
  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  const awaitDoom = doom.start(doomWasm as BufferSource);

  // screen
  doom.updateScreen = (img) => {
    const data = new ImageData(
      img,
      Doom.DOOM_SCREEN_WIDTH,
      Doom.DOOM_SCREEN_HEIGHT,
    );
    ctx.putImageData(data, 0, 0);
  };

  const awaitStream = startMaster({
    ...credentials,
    channelName: context.kinesisChannelName,
    natTraversalDisabled: false,
    forceTURN: true,
    useTrickleICE: true,
    localStream: canvas.captureStream(),
  });

  const doomQuitButton = document.getElementById('doom-quit') as HTMLAnchorElement;
  doomQuitButton.onclick = async () => {
    const stream = await awaitStream;
    // stream.signalingClient?.close();
    Object.entries(stream.peerConnectionByClientId).forEach(([i, pc]) => {
      console.log('closing', i, pc.localDescription);
      pc.close();
    });
  };

  // keyboard

  const iot = new IotClient<DoomKey>({
    credentials,
    awsIotEndpoint: context.awsIotEndpoint,
    topic: context.iotTopic,
  });
  // eslint-disable-next-line @typescript-eslint/require-await
  iot.onMessage = async (k) => {
    if (k.event === KeyEvent.KeyDown) {
      doom.sendKeyDown(k.keyCode);
    } else {
      doom.sendKeyUp(k.keyCode);
    }
  };

  const awaitIot = iot.connect();

  // save/load state

  // eslint-disable-next-line @typescript-eslint/require-await
  doom.onSaveState = async (state) => {
    (window as unknown as DoomWindow).savedState = state;
  };

  const dumpGameButton = document.getElementById('doom-dump') as HTMLAnchorElement;
  dumpGameButton.onclick = () => { doom.requestSaveState(); };

  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = () => {
    const { savedState } = window as unknown as DoomWindow;
    if (!savedState) {
      console.warn('[kv-iot] no saved state');
      return;
    }
    doom.requestLoadState(savedState);
  };

  await Promise.all([awaitDoom, awaitStream, awaitIot]);
}
main().catch((e) => { console.error(e); });
