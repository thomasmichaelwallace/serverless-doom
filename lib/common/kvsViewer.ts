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
  remoteView: HTMLVideoElement,
  channelName: string,
  natTraversalDisabled: boolean,
  forceTURN: boolean,
  clientId: string,
  useTrickleICE: boolean,
};

export default async function startViewer(formValues: StartViewerParams) {
  try {
    viewer.remoteView = formValues.remoteView;

    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: 'eu-west-1',
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      correctClockSkew: true,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({ ChannelName: formValues.channelName })
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
      region: 'eu-west-1',
      accessKeyId: formValues.accessKeyId,
      secretAccessKey: formValues.secretAccessKey,
      sessionToken: formValues.sessionToken,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
      .getIceServerConfig({ ChannelARN: channelARN })
      .promise();
    const iceServers = [];
    if (!formValues.natTraversalDisabled && !formValues.forceTURN) {
      iceServers.push({ urls: `stun:stun.kinesisvideo.${'eu-west-1'}.amazonaws.com:443` });
    }
    if (!formValues.natTraversalDisabled) {
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
      clientId: formValues.clientId,
      role: KVSWebRTC.Role.VIEWER,
      region: 'eu-west-1',
      credentials: {
        accessKeyId: formValues.accessKeyId,
        secretAccessKey: formValues.secretAccessKey,
        sessionToken: formValues.sessionToken,
      },
      systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });

    const configuration = {
      iceServers,
      iceTransportPolicy: formValues.forceTURN ? 'relay' : 'all' as RTCIceTransportPolicy,
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
      if (formValues.useTrickleICE) {
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
        if (formValues.useTrickleICE) {
          console.log('[kvs] [VIEWER] Sending ICE candidate');
          viewer.signalingClient?.sendIceCandidate(candidate);
        }
      } else {
        console.log('[kvs] [VIEWER] All ICE candidates have been generated');

        // When trickle ICE is disabled, send the offer now that all the
        // ICE candidates have ben generated.
        if (!formValues.useTrickleICE) {
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
      if (formValues.remoteView.srcObject) {
        return;
      }
      [viewer.remoteStream] = event.streams;
      // eslint-disable-next-line no-param-reassign
      formValues.remoteView.srcObject = viewer.remoteStream;
    });

    console.log('[kvs] [VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
  } catch (e) {
    console.error('[kvs] [VIEWER] Encountered error starting:', e);
  }
}
