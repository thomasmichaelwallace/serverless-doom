import { KeyCodes, KeyEvent } from './doom';
import { DoomKey } from './types';

export default function toDoomKey(event: KeyboardEvent, type: KeyEvent): DoomKey | false {
  event.preventDefault();
  if (event.repeat) return false;
  const doomMap: Record<string, keyof typeof KeyCodes> = {
    Enter: 'Enter',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Control: 'Ctrl',
    ' ': 'Space',
    Alt: 'Alt',
  };
  const keyCode = doomMap[event.key];
  if (!keyCode) return false;
  return {
    ts: performance.now(),
    event: type,
    keyCode,
  };
}
