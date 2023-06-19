/* eslint-disable no-console */
import * as KVSWebRTC from 'amazon-kinesis-video-streams-webrtc';
import AWS from 'aws-sdk';
import { AwsCredentials } from './types';

type Master = {
  kinesisVideoClient: AWS.KinesisVideo | null;
  channelARN: string | null;
  signalingClient: KVSWebRTC.SignalingClient | null;
  localStream: MediaStream | null;
  peerConnectionByClientId: Record<string, RTCPeerConnection>
};

const master: Master = {
  kinesisVideoClient: null,
  channelARN: null,
  signalingClient: null,
  peerConnectionByClientId: {},
  localStream: null,
};

type StartMasterParams = AwsCredentials & {
  channelName: string,
  natTraversalDisabled: boolean,
  forceTURN: boolean,
  localStream: MediaStream,
  useTrickleICE: boolean,
};

function printSignalingLog(message: string, clientId: string) {
  console.log(`[kvs] ${message}${clientId ? `: ${clientId}` : ' (no senderClientId provided)'}`);
}

export default async function startMaster(
  params: StartMasterParams,
) {
  try {
    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: 'eu-west-1',
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sessionToken: params.sessionToken,
      correctClockSkew: true,
    });
    master.kinesisVideoClient = kinesisVideoClient;

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({ ChannelName: params.channelName })
      .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo?.ChannelARN;
    if (!channelARN) throw new Error('Channel ARN not found');
    console.log('[kvs] [MASTER] Channel ARN:', channelARN);

    master.channelARN = channelARN;

    // Get signaling channel endpoints
    const protocols = ['WSS', 'HTTPS'];
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
      .getSignalingChannelEndpoint({
        ChannelARN: channelARN,
        SingleMasterChannelEndpointConfiguration: {
          Protocols: protocols,
          Role: KVSWebRTC.Role.MASTER,
        },
      })
      .promise();
    const endpointsByProtocol = (getSignalingChannelEndpointResponse.ResourceEndpointList || [])
      .reduce<Record<string, string>>((endpoints, endpoint) => {
      if (!endpoint.ResourceEndpoint || !endpoint.Protocol) {
        throw new Error('Resource without endpoint/protocol');
      }
      // eslint-disable-next-line no-param-reassign
      endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
      return endpoints;
    }, {});
    console.log('[kvs] [MASTER] Endpoints:', endpointsByProtocol);

    // Create Signaling Client
    master.signalingClient = new KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      role: KVSWebRTC.Role.MASTER,
      region: 'eu-west-1',
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        sessionToken: params.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    // Get ICE server configuration
    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
      region: 'eu-west-1',
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sessionToken: params.sessionToken,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
      .getIceServerConfig({
        ChannelARN: channelARN,
      })
      .promise();
    const iceServers = [];
    if (!params.natTraversalDisabled && !params.forceTURN) {
      iceServers.push({ urls: 'stun:stun.kinesisvideo.eu-west-1.amazonaws.com:443' });
    }
    if (!params.natTraversalDisabled) {
      (getIceServerConfigResponse.IceServerList || []).forEach((iceServer) => iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      }));
    }
    console.log('[kvs] [MASTER] ICE servers:', iceServers);

    const configuration = {
      iceServers,
      iceTransportPolicy: params.forceTURN ? 'relay' : 'all' as RTCIceTransportPolicy,
    };

    master.localStream = params.localStream;

    master.signalingClient.on('open', () => {
      console.log('[kvs] [MASTER] Connected to signaling service');
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    master.signalingClient.on('sdpOffer', async (offer: RTCSessionDescriptionInit, remoteClientId: string) => {
      printSignalingLog('[MASTER] Received SDP offer from client', remoteClientId);

      // Create a new peer connection using the offer from the given client
      const peerConnection = new RTCPeerConnection(configuration);
      master.peerConnectionByClientId[remoteClientId] = peerConnection;

      // Send any ICE candidates to the other peer
      peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (!master.signalingClient) throw new Error('No signaling client');

        if (candidate) {
          printSignalingLog('[MASTER] Generated ICE candidate for client', remoteClientId);

          // When trickle ICE is enabled, send the ICE candidates as they are generated.
          if (params.useTrickleICE) {
            printSignalingLog('[MASTER] Sending ICE candidate to client', remoteClientId);
            master.signalingClient.sendIceCandidate(candidate, remoteClientId);
          }
        } else {
          printSignalingLog('[MASTER] All ICE candidates have been generated for client', remoteClientId);

          if (!peerConnection.localDescription) throw new Error('Expected localDescription');

          // When trickle ICE is disabled, send the answer now that all the
          // ICE candidates have ben generated.
          if (!params.useTrickleICE) {
            printSignalingLog('[MASTER] Sending SDP answer to client', remoteClientId);
            master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
          }
        }
      });

      // As remote tracks are received, add them to the remote view
      peerConnection.addEventListener('track', () => {
        printSignalingLog('[MASTER] Received remote track from client', remoteClientId);
      });

      // If there's no video/audio, master.localStream will be null.
      // So, we should skip adding the tracks from it.
      if (!master.localStream) throw new Error("Expected 'master.localStream' to be defined");
      master.localStream.getTracks()
        .forEach((track) => { peerConnection.addTrack(track, master.localStream as MediaStream); });

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
      if (params.useTrickleICE) {
        printSignalingLog('[MASTER] Sending SDP answer to client', remoteClientId);
        if (!master.signalingClient) throw new Error('No signaling client');
        if (!peerConnection.localDescription) throw new Error('Expected localDescription');
        master.signalingClient.sendSdpAnswer(
          peerConnection.localDescription,
          remoteClientId,
        );
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
      console.log('[kvs] [MASTER] Disconnected from signaling channel');
    });

    master.signalingClient.on('error', (error) => {
      console.error('[kvs] [MASTER] Signaling client error', error);
    });

    console.log('[kvs] [MASTER] Starting master connection');
    master.signalingClient.open();

    return master;
  } catch (e) {
    console.error('[kvs] [MASTER] Encountered error starting:', e);
    throw e;
  }
}
