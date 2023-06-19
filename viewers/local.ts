/* eslint-disable no-console */
import Doom, { KeyCodes, KeyEvent } from '../lib/common/doom';
import toDoomKey from '../lib/common/toDoomKey';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

let DUMP: Uint8Array;

const uint8ToBase64 = (arr: Uint8Array): string => btoa(
  Array(arr.length)
    .fill('')
    .map((_, i) => String.fromCharCode(arr[i]))
    .join(''),
);
const base64ToUint8 = (str: string): Uint8Array => Uint8Array
  .from(atob(str), (c) => c.charCodeAt(0));

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
  dumpGameButton.onclick = () => {
    DUMP = new Uint8Array(doom.memory.buffer, 0, doom.memory.buffer.byteLength).slice();
    console.log('dumped', DUMP.byteLength);
    console.log('saveKey', uint8ToBase64(DUMP));
  };
  const recoverGameButton = document.getElementById('doom-recover') as HTMLAnchorElement;
  recoverGameButton.onclick = () => {
    // @ts-expect-error base64Dump is a string
    if (window.base64Dump !== undefined) {
      // @ts-expect-error base64Dump is a string
      DUMP = base64ToUint8(window.base64Dump as string);
      console.log('recovered', DUMP.length);
    }
    if (DUMP === undefined) {
      console.warn('No dump');
      return;
    }
    const bytes = new Uint8Array(doom.memory.buffer, 0, DUMP.length);
    bytes.set(DUMP);
    console.log('recovered', DUMP.length, bytes);
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
