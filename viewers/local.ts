/* eslint-env browser */

/* eslint-disable no-console */
import Doom, { KeyCodes, KeyEvent } from '../lib/common/doom';
import { fromSaveCode, getSaveCode } from '../lib/common/payload';
import toDoomKey from '../lib/common/toDoomKey';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

async function main() {
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const doom = new Doom(ctx);

  const saveGameButton = document.getElementById('doom-save') as HTMLAnchorElement;
  saveGameButton.onclick = () => {
    console.log('saving');
    doom.saveGame();
  };
  const loadGameButton = document.getElementById('doom-load') as HTMLAnchorElement;
  loadGameButton.onclick = () => {
    console.log('loading');
    doom.loadGame();
  };

  const dumpGameButton = document.getElementById('doom-dump') as HTMLAnchorElement;
  dumpGameButton.onclick = async () => {
    const dump = new Uint8Array(doom.memory.buffer, 0, doom.memory.buffer.byteLength);
    const code = await getSaveCode(dump);
    console.log('-- saveKey > --');
    console.log(code);
    console.log('-- < saveKey --');
  };
  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = async () => {
    const { saveKey } = window as unknown as { saveKey?: string };
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

    const code = KeyCodes[key.keyCode];
    if (key.event === KeyEvent.KeyDown) {
      doom.keyDown(code);
    } else {
      doom.keyUp(code);
    }
  };

  window.addEventListener('keydown', (e) => handleKey(e, KeyEvent.KeyDown));
  window.addEventListener('keyup', (e) => handleKey(e, KeyEvent.KeyUp));

  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  await doom.start(doomWasm as BufferSource);
}

main().catch((e) => { console.error(e); });
