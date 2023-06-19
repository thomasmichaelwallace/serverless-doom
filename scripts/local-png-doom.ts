import { readFileSync, writeFileSync } from 'fs';
import Jimp from 'jimp';
import Doom from '../lib/common/doom';

async function main() {
  const wasm = readFileSync('./tmp/doom.wasm');
  const screen = new Jimp(Doom.DOOM_SCREEN_WIDTH, Doom.DOOM_SCREEN_HEIGHT);
  const doom = new Doom(screen);
  doom.updateScreen = (data) => {
    doom.screen = new Jimp({
      data,
      width: Doom.DOOM_SCREEN_WIDTH,
      height: Doom.DOOM_SCREEN_HEIGHT,
    });
  };
  doom.onStep = async () => {
    const png = await doom.screen.getBufferAsync('image/png');
    writeFileSync('./tmp/doom.png', png);
  };
  await doom.start(wasm);
}
// eslint-disable-next-line no-console
main().catch((e) => { console.error(e); process.exit(1); });
