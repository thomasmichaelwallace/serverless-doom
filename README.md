# Serverless Doom

Proving that for AWS Serverless:

Sure - You _Can_ Play Doom On It.

## Setup

### Local Configuration

Create a `tmp` folder in the root of the project.

Include the following files:

`doom.wasm`

You can copy this directly from the `resources` folder, or you can build it yourself:

* Clone https://github.com/diekmann/wasm-fizzbuzz
* Ensure you have rust and clang installed and locally configured
* `cd doom`
* `make doom.wasm`
* Copy the resulting doom.wasm into the `tmp` folder

`credentials.json`

This should be the `json` response from AWS STS' assume-role api.

For example:

```bash
aws --profile [profile name] sts assume-role --role-session-name=doom --role-arn=[local role arn] > ./tmp/credentials.json
```

`context.json`

```json
{
  "awsIotEndpoint": "abcderfgh123-ats.iot.eu-central-1.amazonaws.com",
  "doomBucketName": "serverlessdoomstack-doombucketabcdefgh1234",
  "doomBucketStateKey": "doom-state-key",
  "doomKeyDbTableName": "ServerlessDoomStack-DoomKeyDbabcdefgh123",
  "iotTopic": "doom/keys",
  "kinesisChannelArn": "arn:aws:kinesisvideo:eu-central-1:1234567890:channel/doom-call/1234567890",
  "kinesisChannelName": "doom-call",
  "kvIotDoomLambdaArn": "arn:aws:lambda:eu-central-1:1234567890:function:ServerlessDoomStack-kvIotDoomHandlerABCDEFGH123",
  "region": "eu-central-1"
}
```

Where:
 * `awsIotEndpoint` is the endpoint for your AWS IoT Core instance, you can find this using https://docs.aws.amazon.com/iot/latest/developerguide/iot-connect-devices.html#iot-connect-device-endpoints
 * `doomBucketName` is the name of the S3 bucket created using CDK (see infrastructure)
 * `doomBucketStateKey` can be any S3 Key suitable name for the state (e.g. `doom-state-key`)
 * `doomKeyDbTableName` is the name of the DynamoDB table created using CDK (see infrastructure)
 * `iotTopic` is the topic that the doom key will be published to (e.g. `doom/keys`)
 * `kinesisChannelArn` is the ARN of the Kinesis Video channel you manually created (see infrastructure)
 * `kinesisChannelName` is the name of the Kinesis Video channel you manually created (see infrastructure)
 * `kvIotDoomLambdaArn` is the ARN of the Lambda function created using CDK (see infrastructure)
 * `region` is the region you are using (e.g. `eu-central-1`)

### Infrastructure

Unfortunately the infrastructure is not yet fully automated, so you will need to create some resources manually.

You will need to create the following resources:
 * An AWS Kinesis Video Streams Signalling Channel: https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/gs-createchannel.html
 * Open the AWS IoT Core console to prompt AWS to create an IoT Core endpoint

Once you have done that, you can use:
 * (ensure you have `context.json`, using the dummy values for unknown resources)
 * `npm run cdk bootstrap`
 * `npm run cdk deploy`
 * (update the `context.json` file with the ARNs of the resources created by CDK)
 * `npm run cdk deploy` again
 * upload the `doom.wasm` file to the S3 bucket created by CDK

## Running

### Local

`npm run start` starts a local server on http://localhost:8000/

* Open `s3-dynamo.html` to view the S3/DynamoDB implementation
* Open `kv-iot.html` to view the Kinesis Video Streams/IoT Core implementation

### AWS

From the Lambda console you will have two functions named like:
  * `ServerlessDoomStack-s3DynamoDoomHandlerABCDEFGH123` - this is the S3/DynamoDB implementation
  * `ServerlessDoomStack-kvIotDoomHandlerABCDEFGH123` - this is the Kinesis Video Streams/IoT Core implementation

In both cases they can be invoked using the `test` button with an empty payload.
