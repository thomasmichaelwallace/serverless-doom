/* eslint-disable no-console */
import Doom, { KeyCodes, KeyEvent } from '../lib/common/doom';
import IotClient from '../lib/common/iotClient';
import startMaster from '../lib/common/kvsMaster';
import type { AwsCredentials, CliTmpCredentials, DoomKey } from '../lib/common/types';
import context from '../tmp/context.json';
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

  return Promise.all([awaitDoom, awaitStream, awaitIot]);
}
main().catch((e) => { console.error(e); });
