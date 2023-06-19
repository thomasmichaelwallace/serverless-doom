/* eslint-disable no-console */
import { fromSaveCode, getSaveCode } from './payload';
import { DoomState, KeyEvent } from './types';
import { delay } from './utils';

type DoomExports = {
  main: () => void;
  add_browser_event: (eventType: 0 | 1, keyCode: number) => void;
  doom_loop_step: () => void;
};

export default class Doom {
  // constants

  static DOOM_SCREEN_HEIGHT = 200 * 2;

  static DOOM_SCREEN_WIDTH = 320 * 2;

  // properties

  baseTime = 0;

  framesPerSecond = 25;

  // call backs

  onSaveState: (state: DoomState) => Promise<void>;

  onStep: () => Promise<void>;

  updateScreen: (img: Uint8ClampedArray) => void;

  // private

  private awaitable: Promise<boolean> | undefined;

  private memory: WebAssembly.Memory;

  private nextLoadState: DoomState | undefined;

  private nextSaveState = false;

  private running = false;

  private sendDoomKey: DoomExports['add_browser_event'];

  // methods

  constructor() {
    this.memory = new WebAssembly.Memory({ initial: 108 });
    this.onStep = async () => {};
    this.sendDoomKey = () => {};
    this.updateScreen = () => {};
  }

  requestLoadState(state: DoomState) {
    this.nextLoadState = state;
  }

  requestSaveState() {
    this.nextSaveState = true;
  }

  sendKeyDown(keyCode: number) {
    if (this.sendDoomKey === undefined) {
      console.warn('[doom] key down before init');
      return;
    }
    this.sendDoomKey(KeyEvent.KeyDown, keyCode);
  }

  sendKeyUp(keyCode: number) {
    if (this.sendDoomKey === undefined) {
      console.warn('[doom] key up before init');
      return;
    }
    this.sendDoomKey(KeyEvent.KeyUp, keyCode);
  }

  async start(
    doomWasm: BufferSource,
  ) {
    if (this.running && this.awaitable) {
      console.warn('[doom] start called after init');
      return this.awaitable;
    }
    this.running = true;

    const importObject = {
      js: {
        js_console_log: this.buildLogger('js'),
        js_stdout: this.buildLogger('stdout'),
        js_stderr: this.buildLogger('stderr'),
        js_milliseconds_since_start: () => this.getDoomTime(),
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
    this.sendDoomKey = sendDoomKey;

    // Main game loop
    const step = async (): Promise<boolean> => {
      if (!this.running) {
        console.warn('[doom] stopped');
        return this.running;
      }

      const frameIn = performance.now();

      stepDoom();
      await this.onStep();

      const timeToWait = (1000 / this.framesPerSecond) - (performance.now() - frameIn);
      if (timeToWait > 0) {
        await delay(timeToWait);
      } else {
        console.warn(`[doom] frame took ${-timeToWait}ms too long`);
      }

      if (this.nextSaveState) await this.doSaveState();
      if (this.nextLoadState) await this.doLoadState();

      return step();
    };
    this.awaitable = step();

    return this.awaitable;
  }

  async stop() {
    this.running = false;
    return this.awaitable || Promise.resolve(this.running);
  }

  // privates

  private buildLogger(style: string) {
    return (offset: number, length: number) => {
      const lines = this.readWasmString(offset, length).split('\n');
      lines.forEach((l) => { console.log(`[doom-${style}] ${l}`); });
    };
  }

  private async doLoadState() {
    if (this.nextLoadState === undefined) return;
    const { snapshot, timestamp } = this.nextLoadState;
    this.nextLoadState = undefined;
    const buffer = await fromSaveCode(snapshot);
    if (this.memory.buffer.byteLength < buffer.length) {
      const delta = (buffer.length - this.memory.buffer.byteLength) / 65536; // in 64k pages
      console.log('[doom] growing doom.memory.buffer by', delta, 'pages');
      this.memory.grow(Math.ceil(delta));
    }
    const pointer = new Uint8Array(this.memory.buffer, 0, buffer.length);
    pointer.set(buffer);
    this.setDoomTime(timestamp);
    console.log('[doom] loaded state', buffer.length, snapshot.length, timestamp);
  }

  private async doSaveState() {
    this.nextSaveState = false;
    const buffer = new Uint8Array(this.memory.buffer, 0, this.memory.buffer.byteLength);
    const snapshot = await getSaveCode(buffer);
    const timestamp = this.getDoomTime();
    const state = { snapshot, timestamp };
    console.log('[doom] saved state', timestamp, buffer.length, snapshot.length);
    await this.onSaveState(state);
  }

  private draw(ptr: number) {
    const img = new Uint8ClampedArray(
      this.memory.buffer,
      ptr,
      Doom.DOOM_SCREEN_WIDTH * Doom.DOOM_SCREEN_HEIGHT * 4,
    );
    this.updateScreen(img);
  }

  private getDoomTime() {
    return this.baseTime + performance.now();
  }

  private readWasmString(offset: number, length: number) {
    const bytes = new Uint8Array(this.memory.buffer, offset, length);
    return new TextDecoder('utf8').decode(bytes);
  }

  private setDoomTime(time: number) {
    console.log(`[doom] moving from ${this.getDoomTime()} to ${time}`);
    this.baseTime = time - performance.now();
    console.log(`[doom] moved to ${this.getDoomTime()}`);
  }
}
