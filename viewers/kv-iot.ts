/* eslint-disable no-console */
import { auth } from 'aws-crt/dist.browser/browser'; // eslint-disable-line import/no-extraneous-dependencies
import { iot, mqtt5 } from 'aws-iot-device-sdk-v2';
import { AwsCredentials } from '../lib/common/types';
import context from '../tmp/context.json';
import jsonCredentials from '../tmp/credentials.json';

type ClientParams = {
  credentials: AwsCredentials
  awsIotEndpoint: string,
};

function createClient({
  credentials,
  awsIotEndpoint,
}: ClientParams) : mqtt5.Mqtt5Client {
  console.log(auth, iot, mqtt5);

  const staticProvider = new auth.StaticCredentialProvider({
    aws_access_id: credentials.accessKeyId,
    aws_secret_key: credentials.secretAccessKey,
    aws_sts_token: credentials.sessionToken,
    aws_region: 'eu-west-1',
  });
  console.log(staticProvider);

  const wsConfig : iot.WebsocketSigv4Config = {
    credentialsProvider: staticProvider,
  };

  const builder = iot.AwsIotMqtt5ClientConfigBuilder.newWebsocketMqttBuilderWithSigv4Auth(
    awsIotEndpoint,
    wsConfig,
  );

  const client : mqtt5.Mqtt5Client = new mqtt5.Mqtt5Client(builder.build());
  console.log(client);

  client.on('error', (error) => {
    console.log(`Error event: ${error.toString()}`);
  });

  client.on('messageReceived', (eventData: mqtt5.MessageReceivedEvent) : void => {
    console.log(`Message Received event: ${JSON.stringify(eventData.message)}`);
    if (eventData.message.payload) {
      const txt = (eventData.message.payload as Buffer).toString('utf8');
      console.log(`  with payload: ${txt}`);
    }
  });

  client.on('attemptingConnect', (/* eventData: mqtt5.AttemptingConnectEvent */) => {
    console.log('Attempting Connect event');
  });

  client.on('connectionSuccess', (eventData: mqtt5.ConnectionSuccessEvent) => {
    console.log('Connection Success event');
    console.log(`Connack: ${JSON.stringify(eventData.connack)}`);
    console.log(`Settings: ${JSON.stringify(eventData.settings)}`);
  });

  client.on('connectionFailure', (eventData: mqtt5.ConnectionFailureEvent) => {
    console.log(eventData);
    console.log(`Connection failure event: ${eventData.error.toString()}`);
  });

  client.on('disconnection', (eventData: mqtt5.DisconnectionEvent) => {
    console.log(`Disconnection event: ${eventData.error.toString()}`);
    if (eventData.disconnect !== undefined) {
      console.log(`Disconnect packet: ${JSON.stringify(eventData.disconnect)}`);
    }
  });

  client.on('stopped', (/* eventData: mqtt5.StoppedEvent */) => {
    console.log('Stopped event');
  });

  return client;
}

async function testSuccessfulConnection() {
  const client = createClient({
    credentials: {
      accessKeyId: jsonCredentials.Credentials.AccessKeyId,
      secretAccessKey: jsonCredentials.Credentials.SecretAccessKey,
      sessionToken: jsonCredentials.Credentials.SessionToken,
    },
    awsIotEndpoint: context.awsIotEndpoint,
  });

  const connected = new Promise<void>((resolve) => {
    client.on('connectionSuccess', () => resolve());
  });
  client.start();
  await connected;

  const suback = await client.subscribe({
    subscriptions: [
      { qos: mqtt5.QoS.AtLeastOnce, topicFilter: 'hello/world/qos1' },
      { qos: mqtt5.QoS.AtMostOnce, topicFilter: 'hello/world/qos0' },
    ],
  });
  console.log(`Suback result: ${JSON.stringify(suback)}`);

  const qos0PublishResult = await client.publish({
    qos: mqtt5.QoS.AtMostOnce,
    topicName: 'hello/world/qos0',
    payload: 'This is a qos 0 payload',
  });
  console.log(`QoS 0 Publish result: ${JSON.stringify(qos0PublishResult)}`);

  const qos1PublishResult = await client.publish({
    qos: mqtt5.QoS.AtLeastOnce,
    topicName: 'hello/world/qos1',
    payload: 'This is a qos 1 payload',
  });
  console.log(`QoS 1 Publish result: ${JSON.stringify(qos1PublishResult)}`);

  const unsuback = await client.unsubscribe({
    topicFilters: [
      'hello/world/qos1',
    ],
  });
  console.log(`Unsuback result: ${JSON.stringify(unsuback)}`);

  client.stop();
}

async function main() {
  await testSuccessfulConnection();
}
main().catch((e) => { console.error(e); });
