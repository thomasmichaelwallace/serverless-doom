/* eslint-disable no-console */
import { KeyEvent } from '../lib/common/doom';
import IotClient from '../lib/common/iotClient';
import startViewer from '../lib/common/kvsViewer';
import toDoomKey from '../lib/common/toDoomKey';
import { DoomKey } from '../lib/common/types';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';

const remoteView = document.getElementById('remote-view') as HTMLVideoElement;

const credentials = {
  accessKeyId: jsonCredentials.Credentials.AccessKeyId,
  secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
  sessionToken: jsonCredentials.Credentials.SessionToken,
};

const iot = new IotClient<DoomKey>({
  credentials,
  awsIotEndpoint: context.awsIotEndpoint,
  topic: context.iotTopic,
});

function handleKey(event: KeyboardEvent, type: KeyEvent) {
  const key = toDoomKey(event, type);
  if (!key) return;

  iot.publish(key).catch((e) => { console.error(e); });
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
