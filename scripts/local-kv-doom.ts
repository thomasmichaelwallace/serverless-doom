/* eslint-disable no-console */
import * as KVSWebRTC from 'amazon-kinesis-video-streams-webrtc';
import AWS from 'aws-sdk';
import { readFileSync, writeFileSync } from 'fs';
import WebSocket from 'ws';
import Doom from '../lib/lambda/doom';
import jsonCredentials from '../tmp/credentials.json';

// @ts-expect-error required.
global.WebSocket = WebSocket;

type FormValues = {
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
  endpoint?: string,
  channelName: string,
  // ingestMedia: false,
  natTraversalDisabled: boolean,
  forceTURN: boolean,
  // widescreen: boolean,
  width: number,
  height: number,
  sendVideo: true,
  sendAudio: false,
  useTrickleICE: false,
};

type Master = {
  // localView: HTMLVideoElement;
  // remoteView: HTMLVideoElement;
  kinesisVideoClient: AWS.KinesisVideo;
  channelARN: string;
  streamARN: null;
  signalingClient: KVSWebRTC.SignalingClient;
  localStream: MediaStream;
  peerConnectionByClientId: Record<string, RTCPeerConnection>;
};

// @ts-expect-error uninitialized
const master: Master = {};

function printSignalingLog(message: string, clientId?: string) {
  console.log(`${message}${clientId ? `: ${clientId}` : ' (no senderClientId provided)'}`);
}

async function startMaster(
  // localView: HTMLVideoElement,
  // remoteView: HTMLVideoElement,
  formValues: FormValues,
) {
  try {
    // master.localView = localView;
    // master.remoteView = remoteView;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: formValues.region,
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      endpoint: formValues.endpoint,
      correctClockSkew: true,
    });
    master.kinesisVideoClient = kinesisVideoClient;

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({
        ChannelName: formValues.channelName,
      })
      .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo?.ChannelARN;
    if (!channelARN) {
      throw new Error('[MASTER] Channel does not exist. Please create one in the AWS console');
    }
    console.log('[MASTER] Channel ARN:', channelARN);

    master.channelARN = channelARN;

    const protocols = ['WSS', 'HTTPS'];
    master.streamARN = null;

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
      .getSignalingChannelEndpoint({
        ChannelARN: channelARN,
        SingleMasterChannelEndpointConfiguration: {
          Protocols: protocols,
          Role: KVSWebRTC.Role.MASTER,
        },
      })
      .promise();
    const endpointsByProtocol = (getSignalingChannelEndpointResponse
      .ResourceEndpointList || [])
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
    console.log('[MASTER] Endpoints:', endpointsByProtocol);

    // Create Signaling Client
    master.signalingClient = new KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      role: KVSWebRTC.Role.MASTER,
      region: formValues.region,
      credentials: {
        accessKeyId: formValues.accessKeyId,
        secretAccessKey: formValues.secretAccessKey,
        sessionToken: formValues.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    // Get ICE server configuration
    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
      region: formValues.region,
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });
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
      (getIceServerConfigResponse.IceServerList || []).forEach((iceServer) => iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      }));
    }
    console.log('[MASTER] ICE servers:', iceServers);

    const configuration = {
      iceServers,
      iceTransportPolicy: (formValues.forceTURN ? 'relay' : 'all') as RTCIceTransportPolicy,
    };

    const resolution = {
      width: { ideal: formValues.width },
      height: { ideal: formValues.height },
    };
    const constraints = {
      video: formValues.sendVideo ? resolution : false,
      audio: formValues.sendAudio,
    };

    // Get a stream from the webcam and display it in the local view.
    // If no video/audio needed, no need to request for the sources.
    // Otherwise, the browser will throw an error saying that
    // either video or audio has to be enabled.
    if (formValues.sendVideo || formValues.sendAudio) {
      try {
        // @ts-expect-error uninitialized
        master.localStream = null; // await navigator.mediaDevices.getUserMedia(constraints);

        // localView.srcObject = master.localStream;
      } catch (e) {
        console.error(`[MASTER] Could not find ${Object
          .keys(constraints)
          .filter((k) => constraints[k as keyof typeof constraints])
          .join(' or ')
        } input device.`, e);
        return;
      }
    }

    master.signalingClient.on('open', () => {
      console.log('[MASTER] Connected to signaling service');
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    master.signalingClient.on('sdpOffer', async (offer: RTCSessionDescriptionInit, remoteClientId: string) => {
      printSignalingLog('[MASTER] Received SDP offer from client', remoteClientId);

      // Create a new peer connection using the offer from the given client
      const peerConnection = new RTCPeerConnection(configuration);
      master.peerConnectionByClientId[remoteClientId] = peerConnection;

      // Send any ICE candidates to the other peer
      peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
          printSignalingLog('[MASTER] Generated ICE candidate for client', remoteClientId);

          // When trickle ICE is enabled, send the ICE candidates as they are generated.
          if (formValues.useTrickleICE) {
            printSignalingLog('[MASTER] Sending ICE candidate to client', remoteClientId);
            master.signalingClient.sendIceCandidate(candidate, remoteClientId);
          }
        } else {
          printSignalingLog('[MASTER] All ICE candidates have been generated for client', remoteClientId);

          // When trickle ICE is disabled, send the answer now that all the
          // ICE candidates have ben generated.
          if (!formValues.useTrickleICE && peerConnection.localDescription) {
            printSignalingLog('[MASTER] Sending SDP answer to client', remoteClientId);
            master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
          }
        }
      });

      // As remote tracks are received, add them to the remote view
      peerConnection.addEventListener('track', (/* event */) => {
        printSignalingLog('[MASTER] Received remote track from client?!', remoteClientId);
        // if (remoteView.srcObject) {
        //   return;
        // }

        // [remoteView.srcObject] = event.streams;
      });

      // If there's no video/audio, master.localStream will be null.
      // So, we should skip adding the tracks from it

      if (master.localStream) {
        master.localStream
          .getTracks()
          .forEach((track) => peerConnection.addTrack(track, master.localStream));
      } else {

        // TODO: connect to doom; find a js way to get a media source plugged in.
        /*
        const i420Frame = {
          width: formValues.width,
          height: formValues.height,
          data: new Uint8ClampedArray(1.5 * formValues.width * formValues.height),
        };
        const imagesSource = new WebRTC.nonstandard.RTCVideoSource();
        const imagesTrack = imagesSource.createTrack();
        const mediaStream = new WebRTC.MediaStream([imagesTrack]);

        // on each frame
        const frame = context.getImageData(0, 0, width, height);
        WebRTC.nonstandard.rgbaToI420(frame, i420Frame);
        imagesSource.onFrame(i420Frame);
        mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream));
        */
      }
      await peerConnection.setRemoteDescription(offer);

      // Create an SDP answer to send back to the client
      printSignalingLog('[MASTER] Creating SDP answer for client', remoteClientId);
      await peerConnection.setLocalDescription(
        await peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        }),
      );

      // When trickle ICE is enabled, send the answer now and then send
      // ICE candidates as they are generated. Otherwise wait on the ICE candidates.
      if (formValues.useTrickleICE && peerConnection.localDescription) {
        printSignalingLog('[MASTER] Sending SDP answer to client', remoteClientId);
        master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
      }
      printSignalingLog('[MASTER] Generating ICE candidates for client', remoteClientId);
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    master.signalingClient.on('iceCandidate', async (candidate: RTCIceCandidateInit, remoteClientId: string) => {
      printSignalingLog('[MASTER] Received ICE candidate from client', remoteClientId);

      // Add the ICE candidate received from the client to the peer connection
      const peerConnection = master.peerConnectionByClientId[remoteClientId];
      await peerConnection.addIceCandidate(candidate);
    });

    master.signalingClient.on('close', () => {
      console.log('[MASTER] Disconnected from signaling channel');
    });

    master.signalingClient.on('error', (error) => {
      console.error('[MASTER] Signaling client error', error);
    });

    console.log('[MASTER] Starting master connection');
    master.signalingClient.open();
  } catch (e) {
    console.error('[MASTER] Encountered error starting:', e);
  }
}

const options: FormValues = {
  region: 'eu-west-1',
  ...jsonCredentials,
  channelName: 'tom-test-channel',
  sendVideo: true,
  sendAudio: false,
  natTraversalDisabled: false,
  forceTURN: false,
  useTrickleICE: false,
  width: Doom.DOOM_SCREEN_WIDTH,
  height: Doom.DOOM_SCREEN_HEIGHT,
};

async function main() {
  console.log('[kinesis] connecting to master');
  await startMaster(options);
  console.log('[doom] staring doom');
  const wasm = readFileSync('./tmp/doom.wasm');
  const doom = new Doom();
  doom.onStep = async () => {
    const png = await doom.screen.getBufferAsync('image/png');
    writeFileSync('./tmp/doom.png', png);
  };
  await doom.start(wasm);
}
main().catch((e) => { console.error(e); process.exit(1); });
