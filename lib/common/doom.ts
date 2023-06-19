/* eslint-disable no-console */
import { KeyEvent } from './types';

type DoomExports = {
  main: () => void;
  add_browser_event: (eventType: 0 | 1, keyCode: number) => void;
  doom_loop_step: () => void;
};

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

export default class Doom {
  static DOOM_SCREEN_HEIGHT = 200 * 2;

  static DOOM_SCREEN_WIDTH = 320 * 2;

  memory: WebAssembly.Memory;

  framesPerSecond = 25;

  baseTime = 0;

  sendKeyDown: (keyCode: number) => void;

  sendKeyUp : (keyCode: number) => void;

  onStep: () => Promise<void>;

  updateScreen: (img: Uint8ClampedArray) => void;

  private startAwaitable: Promise<void> | undefined = undefined;

  constructor() {
    this.memory = new WebAssembly.Memory({ initial: 108 });
    this.onStep = async () => {};
    this.sendKeyDown = () => {};
    this.sendKeyUp = () => {};
  }

  private readWasmString(offset: number, length: number) {
    const bytes = new Uint8Array(this.memory.buffer, offset, length);
    return new TextDecoder('utf8').decode(bytes);
  }

  private buildLogger(style: string) {
    return (offset: number, length: number) => {
      const lines = this.readWasmString(offset, length).split('\n');
      lines.forEach((l) => { console.log(`[doom-${style}] ${l}`); });
    };
  }

  private draw(ptr: number) {
    const img = new Uint8ClampedArray(
      this.memory.buffer,
      ptr,
      Doom.DOOM_SCREEN_WIDTH * Doom.DOOM_SCREEN_HEIGHT * 4,
    );
    this.updateScreen(img);
  }

  async start(
    doomWasm: BufferSource,
  ) {
    if (this.startAwaitable !== undefined) {
      console.warn('Doom already started');
      return this.startAwaitable;
    }

    const importObject = {
      js: {
        js_console_log: this.buildLogger('js'),
        js_stdout: this.buildLogger('stdout'),
        js_stderr: this.buildLogger('stderr'),
        js_milliseconds_since_start: () => this.baseTime + performance.now(),
        js_draw_screen: (ptr: number) => this.draw(ptr),
      },
      env: { memory: this.memory },
    };

    const doom = await WebAssembly.instantiate(doomWasm, importObject);

    const {
      main: initDoom,
      add_browser_event: sendDoomKey,
      doom_loop_step: stepDoom,
    } = doom.instance.exports as DoomExports;

    initDoom();

    // attach inputs
    this.sendKeyDown = (keyCode) => sendDoomKey(KeyEvent.KeyDown, keyCode);
    this.sendKeyUp = (keyCode) => sendDoomKey(KeyEvent.KeyUp, keyCode);

    // Main game loop
    const step = async (): Promise<void> => {
      const frameIn = performance.now();

      stepDoom();
      await this.onStep();

      const timeToWait = (1000 / this.framesPerSecond) - (performance.now() - frameIn);
      if (timeToWait > 0) {
        await delay(timeToWait);
      } else {
        console.warn(`Frame took ${-timeToWait}ms too long`);
      }

      return step();
    };

    this.startAwaitable = step();
    return this.startAwaitable;
  }
}
