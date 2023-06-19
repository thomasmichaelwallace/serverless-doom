/* eslint-disable no-console */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import Doom, { KeyCodes, KeyEvent } from '../lib/common/doom';
import startMaster from '../lib/common/kvsMaster';
import type { AwsCredentials, CliTmpCredentials, DoomKey } from '../lib/common/types';
import context from '../tmp/context.json';
// @ts-expect-error doomWasm is a string
import doomWasmName from '../tmp/doom.wasm';

const DOOM_KEY_DB_TABLE_NAME = context.doomKeyDbTableName;

async function getKeys(ddb: DynamoDBDocumentClient) {
  const TableName = DOOM_KEY_DB_TABLE_NAME;
  const command = new ScanCommand({ TableName });
  const data = await ddb.send(command);
  data.Items?.sort((a, b) => a.ts - b.ts);
  await Promise.all((data.Items as DoomKey[] || []).map(async (i) => {
    const c = new DeleteCommand({ TableName, Key: { ts: i.ts } });
    await ddb.send(c);
  }));
  return (data.Items || []) as DoomKey[];
}

async function main() {
  const canvas = document.getElementById('doom-frame') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const doom = new Doom(ctx);
  doom.updateScreen = (img) => {
    const data = new ImageData(
      img,
      Doom.DOOM_SCREEN_WIDTH,
      Doom.DOOM_SCREEN_HEIGHT,
    );
    ctx.putImageData(data, 0, 0);
  };

  const doomWasm = await fetch(doomWasmName as string).then((r) => r.arrayBuffer());
  const jsonCredentials = await fetch('./credentials.json').then((r) => r.json() as unknown as CliTmpCredentials);
  const awaitDoom = doom.start(doomWasm as BufferSource);

  const credentials: AwsCredentials = {
    accessKeyId: jsonCredentials.Credentials.AccessKeyId,
    secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
    sessionToken: jsonCredentials.Credentials.SessionToken,
  };

  const awaitStream = startMaster({
    ...credentials,
    channelName: context.kinesisChannelName,
    natTraversalDisabled: false,
    forceTURN: true,
    useTrickleICE: true,
    localStream: canvas.captureStream(),
  });

  const config = { region: 'eu-west-1', credentials };
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config));
  doom.onStep = async () => {
    const keys = await getKeys(ddb);
    keys.forEach((k) => {
      const key = KeyCodes[k.keyCode];
      if (k.event === KeyEvent.KeyDown) {
        doom.sendKeyDown(key);
      } else {
        doom.sendKeyUp(key);
      }
    });
  };

  return Promise.all([awaitDoom, awaitStream]);
}
main().catch((e) => { console.error(e); });
