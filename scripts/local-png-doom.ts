import { readFileSync, writeFileSync } from 'fs';
import Doom from '../lib/lambda/doom';

async function main() {
  const wasm = readFileSync('./tmp/doom.wasm');
  const doom = new Doom();
  doom.onStep = async () => {
    const png = await doom.screen.getBufferAsync('image/png');
    writeFileSync('./tmp/doom.png', png);
  };
  await doom.start(wasm);
}
// eslint-disable-next-line no-console
main().catch((e) => { console.error(e); process.exit(1); });
