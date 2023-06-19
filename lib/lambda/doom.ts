import Jimp from 'jimp';

type DoomExports = {
  main: () => void;
  add_browser_event: (eventType: 0 | 1, keyCode: number) => void;
  doom_loop_step: () => void;
};

export enum KeyEvent {
  KeyDown = 0,
  KeyUp = 1,
}

export enum KeyCodes {
  Enter = 13,
  Left = 0xac,
  Right = 0xae,
  Up = 0xad,
  Down = 0xaf,
  Ctrl = 0x80 + 0x1d,
  Space = 32,
  Alt = 0x80 + 0x38,
}

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

export default class Doom {
  static DOOM_SCREEN_HEIGHT = 200 * 2;

  static DOOM_SCREEN_WIDTH = 320 * 2;

  DOOM_FRAMES_PER_SECOND = 25;

  memory: WebAssembly.Memory;

  keyDown: (keyCode: number) => void;

  keyUp : (keyCode: number) => void;

  onStep: () => Promise<void>;

  screen: Jimp;

  private startAwaitable: Promise<void> | undefined = undefined;

  constructor() {
    this.memory = new WebAssembly.Memory({ initial: 108 });
    this.screen = new Jimp(Doom.DOOM_SCREEN_WIDTH, Doom.DOOM_SCREEN_HEIGHT);
    this.onStep = async () => {};
    this.keyDown = () => {};
    this.keyUp = () => {};
  }

  readWasmString(offset: number, length: number) {
    const bytes = new Uint8Array(this.memory.buffer, offset, length);
    return new TextDecoder('utf8').decode(bytes);
  }

  appendOutput(style: string) {
    return (offset: number, length: number) => {
      const lines = this.readWasmString(offset, length).split('\n');
      lines.forEach((l) => {
        // eslint-disable-next-line no-console
        console.log(`[${style}] ${l}`);
      });
    };
  }

  drawCanvas(ptr: number) {
    const doomScreen = new Uint8ClampedArray(
      this.memory.buffer,
      ptr,
      Doom.DOOM_SCREEN_WIDTH * Doom.DOOM_SCREEN_HEIGHT * 4,
    );
    this.screen = new Jimp({
      data: doomScreen,
      width: Doom.DOOM_SCREEN_WIDTH,
      height: Doom.DOOM_SCREEN_HEIGHT,
    });
  }

  async start(
    doomWasm: BufferSource,
  ) {
    if (this.startAwaitable !== undefined) {
      // eslint-disable-next-line no-console
      console.warn('Doom already started');
      return this.startAwaitable;
    }

    const importObject = {
      js: {
        js_console_log: this.appendOutput('log'),
        js_stdout: this.appendOutput('stdout'),
        js_stderr: this.appendOutput('stderr'),
        js_milliseconds_since_start: () => performance.now(),
        js_draw_screen: (ptr: number) => this.drawCanvas(ptr),
      },
      env: { memory: this.memory },
    };

    const doom = await WebAssembly.instantiate(doomWasm, importObject);

    const {
      main: startDoom,
      add_browser_event: sendBrowserEvent,
      doom_loop_step: nextDoomStep,
    } = doom.instance.exports as DoomExports;

    startDoom();

    // input
    this.keyDown = function onKeyDown(keyCode) {
      sendBrowserEvent(KeyEvent.KeyDown, keyCode);
    };
    this.keyUp = function onKeyUp(keyCode) {
      sendBrowserEvent(KeyEvent.KeyUp, keyCode);
    };

    // Main game loop
    const step = async (): Promise<void> => {
      const frameIn = performance.now();

      nextDoomStep();
      await this.onStep();

      const timeToWait = (1000 / this.DOOM_FRAMES_PER_SECOND) - (performance.now() - frameIn);
      if (timeToWait > 0) {
        await delay(timeToWait);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`Frame took ${-timeToWait}ms too long`);
      }

      return step();
    };

    this.startAwaitable = step();
    return this.startAwaitable;
  }
}
