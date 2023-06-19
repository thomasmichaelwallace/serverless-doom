/* eslint-disable no-console */
import * as KVSWebRTC from 'amazon-kinesis-video-streams-webrtc';
import AWS from 'aws-sdk';
import jsonCredentials from '../tmp/credentials.json';

type FormValues = {
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
  endpoint?: string,
  channelName: string,
  clientId?: string,
  sendVideo: boolean,
  sendAudio: boolean,
  openDataChannel: boolean,
  // widescreen: boolean, // true: 1280x720 (16:9 widescreen) / false : 640x480 (4:3 fullscreen)
  width: number,
  height: number,
  natTraversalDisabled: boolean,
  forceTURN: boolean,
  useTrickleICE: boolean,
};

type Viewer = {
  localView: HTMLVideoElement,
  remoteView: HTMLVideoElement,
  signalingClient: KVSWebRTC.SignalingClient,
  peerConnection: RTCPeerConnection,
  dataChannel: RTCDataChannel,
  localStream: MediaStream,
  remoteStream: MediaStream,
  peerConnectionStatsInterval: NodeJS.Timeout,
};

// @ts-expect-error not initialized
const viewer: Viewer = {};

async function startViewer(
  localView: HTMLVideoElement,
  remoteView: HTMLVideoElement,
  formValues: FormValues,
  // onStatsReport,
  onRemoteDataMessage: RTCDataChannel['onmessage'],
) {
  try {
    viewer.localView = localView;
    viewer.remoteView = remoteView;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: formValues.region,
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      endpoint: formValues.endpoint,
      correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({
        ChannelName: formValues.channelName,
      })
      .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo?.ChannelARN;

    if (!channelARN) throw new Error('Channel ARN not found');

    console.log('[VIEWER] Channel ARN:', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
      .getSignalingChannelEndpoint({
        ChannelARN: channelARN,
        SingleMasterChannelEndpointConfiguration: {
          Protocols: ['WSS', 'HTTPS'],
          Role: KVSWebRTC.Role.VIEWER,
        },
      })
      .promise();
    if (!getSignalingChannelEndpointResponse.ResourceEndpointList) {
      throw new Error('Channel Endpoints not found');
    }
    const endpointsByProtocol = getSignalingChannelEndpointResponse
      .ResourceEndpointList
      .reduce<Record<string, string>>(
      (endpoints, endpoint) => {
        if (endpoint.Protocol && endpoint.ResourceEndpoint) {
        // eslint-disable-next-line no-param-reassign
          endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        }
        return endpoints;
      },
      {},
    );
    console.log('[VIEWER] Endpoints:', endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
      region: formValues.region,
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
      .getIceServerConfig({
        ChannelARN: channelARN,
      })
      .promise();
    const iceServers = [];
    if (!formValues.natTraversalDisabled && !formValues.forceTURN) {
      iceServers.push({ urls: `stun:stun.kinesisvideo.${formValues.region}.amazonaws.com:443` });
    }
    if (!formValues.natTraversalDisabled) {
      getIceServerConfigResponse.IceServerList?.forEach((iceServer) => iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      }));
    }
    console.log('[VIEWER] ICE servers:', iceServers);

    // Create Signaling Client
    viewer.signalingClient = new KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      clientId: formValues.clientId,
      role: KVSWebRTC.Role.VIEWER,
      region: formValues.region,
      credentials: {
        accessKeyId: formValues.accessKeyId,
        secretAccessKey: formValues.secretAccessKey,
        sessionToken: formValues.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    const resolution = {
      width: { ideal: formValues.width },
      height: { ideal: formValues.height },
    };
    const constraints = {
      video: formValues.sendVideo ? resolution : false,
      audio: formValues.sendAudio,
    };
    const configuration = {
      iceServers,
      iceTransportPolicy: (formValues.forceTURN ? 'relay' : 'all') as RTCIceTransportPolicy,
    };
    viewer.peerConnection = new RTCPeerConnection(configuration);
    if (formValues.openDataChannel) {
      viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
      viewer.peerConnection.ondatachannel = (event: RTCDataChannelEvent) => {
        // eslint-disable-next-line no-param-reassign
        event.channel.onmessage = onRemoteDataMessage;
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('open', async () => {
      console.log('[VIEWER] Connected to signaling service');

      // Get a stream from the webcam, add it to the peer connection,
      // and display it in the local view.
      // If no video/audio needed, no need to request for the sources.
      // Otherwise, the browser will throw an error saying that either video
      // or audio has to be enabled.
      if (formValues.sendVideo || formValues.sendAudio) {
        try {
          viewer.localStream = await navigator.mediaDevices.getUserMedia(constraints);
          viewer.localStream
            .getTracks()
            .forEach((track) => viewer.peerConnection.addTrack(track, viewer.localStream));
          // eslint-disable-next-line no-param-reassign
          localView.srcObject = viewer.localStream;
        } catch (e) {
          console.error(`[VIEWER] Could not find ${Object
            .keys(constraints)
            .filter((k) => constraints[k as keyof typeof constraints])
            .join(' and ')
          } input device.`, e);
          return;
        }
      }

      // Create an SDP offer to send to the master
      console.log('[VIEWER] Creating SDP offer');
      await viewer.peerConnection.setLocalDescription(
        await viewer.peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        }),
      );

      // When trickle ICE is enabled, send the offer now and then send ICE
      // candidates as they are generated. Otherwise wait on the ICE candidates.
      if (formValues.useTrickleICE) {
        console.log('[VIEWER] Sending SDP offer');
        if (viewer.peerConnection.localDescription) {
          viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        }
      }
      console.log('[VIEWER] Generating ICE candidates');
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('sdpAnswer', async (answer: RTCSessionDescriptionInit) => {
      // Add the SDP answer to the peer connection
      console.log('[VIEWER] Received SDP answer');
      await viewer.peerConnection.setRemoteDescription(answer);
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('iceCandidate', async (candidate: RTCIceCandidateInit) => {
      // Add the ICE candidate received from the MASTER to the peer connection
      console.log('[VIEWER] Received ICE candidate');
      await viewer.peerConnection.addIceCandidate(candidate);
    });

    viewer.signalingClient.on('close', () => {
      console.log('[VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', (error) => {
      console.error('[VIEWER] Signaling client error:', error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) {
        console.log('[VIEWER] Generated ICE candidate');

        // When trickle ICE is enabled, send the ICE candidates as they are generated.
        if (formValues.useTrickleICE) {
          console.log('[VIEWER] Sending ICE candidate');
          viewer.signalingClient.sendIceCandidate(candidate);
        }
      } else {
        console.log('[VIEWER] All ICE candidates have been generated');

        // When trickle ICE is disabled, send the offer now that all the ICE
        // candidates have ben generated.
        if (!formValues.useTrickleICE && viewer.peerConnection.localDescription) {
          console.log('[VIEWER] Sending SDP offer');
          viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        }
      }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', (event) => {
      console.log('[VIEWER] Received remote track');
      if (remoteView.srcObject) {
        return;
      }
      [viewer.remoteStream] = event.streams;
      // eslint-disable-next-line no-param-reassign
      remoteView.srcObject = viewer.remoteStream;
    });

    console.log('[VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
  } catch (e) {
    console.error('[VIEWER] Encountered error starting:', e);
  }
}

const localView = document.getElementById('local-view') as HTMLVideoElement;
const remoteView = document.getElementById('remote-view') as HTMLVideoElement;
const formValue: FormValues = {
  region: 'eu-west-1',
  ...jsonCredentials,
  channelName: 'tom-test-channel',
  sendVideo: false,
  sendAudio: false,
  openDataChannel: false,
  natTraversalDisabled: false,
  forceTURN: false,
  useTrickleICE: true,
  width: 1280,
  height: 720,
  clientId: 'tom-test-client',
};
startViewer(localView, remoteView, formValue, (e) => {
  console.info(e);
}).catch((e) => { console.error(e); });
