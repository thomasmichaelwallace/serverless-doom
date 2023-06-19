import { DoomKey, KeyEvent } from './types';

export default function toDoomKey(event: KeyboardEvent, type: KeyEvent): DoomKey | false {
  event.preventDefault();

  // do not resend repeats, as we're sending individual key up/downs
  if (event.repeat) return false;

  let { keyCode } = event;
  switch (keyCode) {
    case 8:
      keyCode = 127; // KEY_BACKSPACE
      break;
    case 17:
      keyCode = (0x80 + 0x1d); // KEY_RCTRL
      break;
    case 18:
      keyCode = (0x80 + 0x38); // KEY_RALT
      break;
    case 37:
      keyCode = 0xac; // KEY_LEFTARROW
      break;
    case 38:
      keyCode = 0xad; // KEY_UPARROW
      break;
    case 39:
      keyCode = 0xae; // KEY_RIGHTARROW
      break;
    case 40:
      keyCode = 0xaf; // KEY_DOWNARROW
      break;
    default:
      if (keyCode >= 65 /* A */ && keyCode <= 90 /* Z */) {
        keyCode += 32; // ASCII to lower case
      }
      if (keyCode >= 112 /* F1 */ && keyCode <= 123 /* F12 */) {
        keyCode += 75; // KEY_F1
      }
  }

  return {
    ts: performance.now(),
    event: type,
    keyCode,
  };
}
