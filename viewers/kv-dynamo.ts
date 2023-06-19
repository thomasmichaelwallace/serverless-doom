/* eslint-disable no-console */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { KeyCodes, KeyEvent } from '../lib/common/doom';
import startViewer from '../lib/common/kvsViewer';
import jsonCredentials from '../tmp/credentials.json';

const remoteView = document.getElementById('remote-view') as HTMLVideoElement;

const DOOM_KEY_DB_TABLE_NAME = 'ServerlessDoomStack-DoomKeyDbED051C17-P00PEGLDRZJU';

const config = { region: 'eu-west-1', credentials: jsonCredentials };
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config));

function handleKey(event: KeyboardEvent, type: KeyEvent) {
  if (event.repeat) return;
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
  if (keyCode) {
    const command = new PutCommand({
      Item: {
        ts: performance.now(),
        event: type,
        keyCode,
      },
      TableName: DOOM_KEY_DB_TABLE_NAME,
    });
    ddb.send(command).catch((e) => {
      console.error('Failed to save key', e);
    });
  }

  event.preventDefault();
}

async function main() {
  await startViewer({
    ...jsonCredentials,
    channelName: 'tom-test-channel',
    remoteView,
    clientId: `doom-client-${Math.floor(Math.random() * 1000)}`,
    natTraversalDisabled: false,
    forceTURN: false,
    useTrickleICE: true,
  });

  window.addEventListener('keydown', (e) => handleKey(e, KeyEvent.KeyDown));
  window.addEventListener('keyup', (e) => handleKey(e, KeyEvent.KeyUp));
}
main().catch((e) => { console.error(e); });
