/* eslint-disable no-console */
import { auth } from 'aws-crt/dist.browser/browser'; // eslint-disable-line import/no-extraneous-dependencies
import { iot, mqtt5 } from 'aws-iot-device-sdk-v2';
import { AwsCredentials } from './types';

const DEBUG_LOG = false;

type IotClientParams = {
  credentials: AwsCredentials
  awsIotEndpoint: string,
  topic: string,
};

export default class IotClient<T> {
  client : mqtt5.Mqtt5Client;

  connected: Promise<void> | undefined;

  topic: string;

  onMessage: (message: T) => Promise<void>;

  constructor({
    credentials,
    awsIotEndpoint,
    topic,
  }: IotClientParams) {
    console.log('[iot-client] starting');

    this.onMessage = () => Promise.resolve();

    const staticProvider = new auth.StaticCredentialProvider({
      aws_access_id: credentials.accessKeyId,
      aws_secret_key: credentials.secretAccessKey,
      aws_sts_token: credentials.sessionToken,
      aws_region: 'eu-west-1',
    });

    const builder = iot.AwsIotMqtt5ClientConfigBuilder.newWebsocketMqttBuilderWithSigv4Auth(
      awsIotEndpoint,
      { credentialsProvider: staticProvider },
    );

    this.client = new mqtt5.Mqtt5Client(builder.build());

    this.client.on('error', (error) => {
      console.log(`[iot-client] error: ${error.toString()}`);
    });

    this.topic = topic;
  }

  async connect(): Promise<void> {
    if (this.connected) return this.connected;

    this.connected = new Promise<void>((resolve) => {
      this.client.on('connectionSuccess', () => {
        console.log('[iot-client] connected');
        resolve();
      });
    });

    this.client.start();
    await this.connected;

    const suback = await this.client.subscribe({
      subscriptions: [
        { qos: mqtt5.QoS.AtLeastOnce, topicFilter: this.topic },
      ],
    });
    if (DEBUG_LOG) console.log(`[iot-client] suback result: ${JSON.stringify(suback)}`);

    this.client.on('messageReceived', (eventData: mqtt5.MessageReceivedEvent) => {
      if (DEBUG_LOG) console.log(`[iot-client] message Received event: ${JSON.stringify(eventData.message)}`);
      if (eventData.message.payload) {
        const txt = (eventData.message.payload as Buffer).toString('utf8');
        if (DEBUG_LOG) console.log(`[iot-client]  with payload: ${txt}`);
        const obj = JSON.parse(txt) as T;
        this.onMessage(obj).catch((err) => {
          console.log('[iot-client] on message error', err);
        });
      }
    });

    return this.connected;
  }

  async publish(message: T): Promise<void> {
    if (!this.connected) await this.connect();
    const payload = JSON.stringify(message);
    if (DEBUG_LOG) console.log(`[iot-client] publishing message: ${payload}`);
    const puback = await this.client.publish({
      qos: mqtt5.QoS.AtLeastOnce,
      topicName: this.topic,
      payload,
    });
    if (DEBUG_LOG) console.log(`[iot-client] puback result: ${JSON.stringify(puback)}`);
  }
}
