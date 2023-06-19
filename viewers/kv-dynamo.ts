/* eslint-disable no-console */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { KeyEvent } from '../lib/common/doom';
import startViewer from '../lib/common/kvsViewer';
import toDoomKey from '../lib/common/toDoomKey';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';

const remoteView = document.getElementById('remote-view') as HTMLVideoElement;

const DOOM_KEY_DB_TABLE_NAME = context.doomKeyDbTableName;

const credentials = {
  accessKeyId: jsonCredentials.Credentials.AccessKeyId,
  secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
  sessionToken: jsonCredentials.Credentials.SessionToken,
};
const config = { region: 'eu-west-1', credentials };
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config));

function handleKey(event: KeyboardEvent, type: KeyEvent) {
  const Item = toDoomKey(event, type);
  if (!Item) return;

  const command = new PutCommand({
    Item,
    TableName: DOOM_KEY_DB_TABLE_NAME,
  });
  ddb.send(command).catch((e) => {
    console.error('Failed to save key', e);
  });
}

async function main() {
  await startViewer({
    ...credentials,
    channelName: context.kinesisChannelName,
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
