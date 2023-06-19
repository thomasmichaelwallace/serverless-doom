/* eslint-disable no-console */
import * as KVSWebRTC from 'amazon-kinesis-video-streams-webrtc';
import AWS from 'aws-sdk';
import { AwsCredentials } from './types';

type Viewer = {
  remoteView: HTMLVideoElement | null;
  signalingClient: KVSWebRTC.SignalingClient | null,
  peerConnection: RTCPeerConnection | null,
  remoteStream: MediaStream | null,
};

const viewer: Viewer = {
  remoteView: null,
  signalingClient: null,
  peerConnection: null,
  remoteStream: null,
};

type StartViewerParams = AwsCredentials & {
  region: string,
  remoteView: HTMLVideoElement,
  channelName: string,
  natTraversalDisabled: boolean,
  forceTURN: boolean,
  clientId: string,
  useTrickleICE: boolean,
};

export default async function startViewer(params: StartViewerParams) {
  try {
    viewer.remoteView = params.remoteView;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sessionToken: params.sessionToken,
      correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({ ChannelName: params.channelName })
      .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo?.ChannelARN;
    if (!channelARN) throw new Error('Channel ARN not found');
    console.log('[kvs] [VIEWER] Channel ARN:', channelARN);

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
    const endpointsByProtocol = (getSignalingChannelEndpointResponse.ResourceEndpointList || [])
      .reduce<Record<string, string>>((endpoints, endpoint) => {
      if (!endpoint.Protocol || !endpoint.ResourceEndpoint) {
        throw new Error('Endpoint protocol or URL not found');
      }
      // eslint-disable-next-line no-param-reassign
      endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
      return endpoints;
    }, {});
    console.log('[kvs] [VIEWER] Endpoints:', endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sessionToken: params.sessionToken,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
      .getIceServerConfig({ ChannelARN: channelARN })
      .promise();
    const iceServers = [];
    if (!params.natTraversalDisabled && !params.forceTURN) {
      iceServers.push({ urls: `stun:stun.kinesisvideo.${params.region}.amazonaws.com:443` });
    }
    if (!params.natTraversalDisabled) {
      (getIceServerConfigResponse.IceServerList || []).forEach((iceServer) => iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      }));
    }
    console.log('[kvs] [VIEWER] ICE servers:', iceServers);

    // Create Signaling Client
    viewer.signalingClient = new KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      clientId: params.clientId,
      role: KVSWebRTC.Role.VIEWER,
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        sessionToken: params.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    const configuration = {
      iceServers,
      iceTransportPolicy: params.forceTURN ? 'relay' : 'all' as RTCIceTransportPolicy,
    };
    viewer.peerConnection = new RTCPeerConnection(configuration);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('open', async () => {
      console.log('[kvs] [VIEWER] Connected to signaling service');

      // Create an SDP offer to send to the master
      console.log('[kvs] [VIEWER] Creating SDP offer');
      await viewer.peerConnection?.setLocalDescription(
        await viewer.peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        }),
      );

      // When trickle ICE is enabled, send the offer now and then send ICE candidates
      // as they are generated. Otherwise wait on the ICE candidates.
      if (params.useTrickleICE) {
        console.log('[kvs] [VIEWER] Sending SDP offer');
        viewer.signalingClient?.sendSdpOffer(
          viewer.peerConnection?.localDescription as RTCSessionDescription,
        );
      }
      console.log('[kvs] [VIEWER] Generating ICE candidates');
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('sdpAnswer', async (answer: RTCSessionDescriptionInit) => {
      // Add the SDP answer to the peer connection
      console.log('[kvs] [VIEWER] Received SDP answer');
      await viewer.peerConnection?.setRemoteDescription(answer);
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    viewer.signalingClient.on('iceCandidate', async (candidate: RTCIceCandidate) => {
      // Add the ICE candidate received from the MASTER to the peer connection
      console.log('[kvs] [VIEWER] Received ICE candidate');
      await viewer.peerConnection?.addIceCandidate(candidate);
    });

    viewer.signalingClient.on('close', () => {
      console.log('[kvs] [VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', (error) => {
      console.error('[VIEWER] Signaling client error:', error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) {
        console.log('[kvs] [VIEWER] Generated ICE candidate');

        // When trickle ICE is enabled, send the ICE candidates as they are generated.
        if (params.useTrickleICE) {
          console.log('[kvs] [VIEWER] Sending ICE candidate');
          viewer.signalingClient?.sendIceCandidate(candidate);
        }
      } else {
        console.log('[kvs] [VIEWER] All ICE candidates have been generated');

        // When trickle ICE is disabled, send the offer now that all the
        // ICE candidates have ben generated.
        if (!params.useTrickleICE) {
          console.log('[kvs] [VIEWER] Sending SDP offer');
          viewer.signalingClient?.sendSdpOffer(
            viewer.peerConnection?.localDescription as RTCSessionDescription,
          );
        }
      }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', (event) => {
      console.log('[kvs] [VIEWER] Received remote track');
      if (params.remoteView.srcObject) {
        return;
      }
      [viewer.remoteStream] = event.streams;
      // eslint-disable-next-line no-param-reassign
      params.remoteView.srcObject = viewer.remoteStream;
    });

    setInterval(() => {
      console.log('[kvs] [VIEWER]', viewer.peerConnection?.connectionState);
    }, 1000);
    viewer.peerConnection.addEventListener('connectionstatechange', (event) => {
      console.log('[kvs] [VIEWER] Connection state change:', event);
    });

    console.log('[kvs] [VIEWER] Starting viewer connection');
    viewer.signalingClient.open();

    return viewer;
  } catch (e) {
    console.error('[kvs] [VIEWER] Encountered error starting:', e);
    throw e;
  }
}
