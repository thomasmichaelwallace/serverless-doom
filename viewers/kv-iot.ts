/* eslint-disable no-console */
import IotClient from '../lib/common/iotClient';
import startViewer from '../lib/common/kvsViewer';
import toDoomKey from '../lib/common/toDoomKey';
import { DoomKey, KeyEvent } from '../lib/common/types';
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

async function doViewer() {
  console.log('starting viewer');
  const viewer = await startViewer({
    ...credentials,
    region: context.region,
    channelName: context.kinesisChannelName,
    remoteView,
    clientId: `doom-client-${Math.floor(Math.random() * 1000)}`,
    natTraversalDisabled: false,
    forceTURN: false,
    useTrickleICE: true,
  });
  const onConnectionChanged = () => {
    if (![undefined, 'connected', 'connecting'].includes(viewer.peerConnection?.connectionState)) {
      console.log('connection lost', viewer.peerConnection?.connectionState);
      viewer.peerConnection?.removeEventListener('connectionstatechange', onConnectionChanged);
      doViewer().catch((e) => { console.error(e); });
      window.location.reload();
    }
  };
  viewer.peerConnection?.addEventListener('connectionstatechange', onConnectionChanged);
}

async function main() {
  await doViewer();
  window.addEventListener('keydown', (e) => handleKey(e, KeyEvent.KeyDown));
  window.addEventListener('keyup', (e) => handleKey(e, KeyEvent.KeyUp));
}
main().catch((e) => { console.error(e); });
