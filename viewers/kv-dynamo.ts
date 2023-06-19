/* eslint-disable no-console */
import startViewer from '../lib/common/kvsViewer';
import jsonCredentials from '../tmp/credentials.json';

const remoteView = document.getElementById('remote-view') as HTMLVideoElement;

startViewer({
  ...jsonCredentials,
  channelName: 'tom-test-channel',
  remoteView,
  clientId: `doom-client-${Math.floor(Math.random() * 1000)}`,
  natTraversalDisabled: false,
  forceTURN: false,
  useTrickleICE: true,
}).catch((e) => { console.error(e); });
