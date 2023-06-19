import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export default class ServerlessDoomStack extends Stack {
  helloDoomLambda: NodejsFunction;

  s3DynamoDoomLambda: NodejsFunction;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.helloDoomLambda = new NodejsFunction(this, 'HelloDoomHandler', {
      entry: 'lib/lambda/hello-doom.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
    });

    const doomBucket = new s3.Bucket(this, 'DoomBucket', {
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
          ],
          allowedOrigins: ['http://localhost:8000'],
          allowedHeaders: ['*'],
        },
      ],
    });

    const doomKeyDb = new dynamodb.Table(this, 'DoomKeyDb', {
      partitionKey: { name: 'ts', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const s3DynamoDoomLambdaEnv = {
      DOOM_BUCKET_NAME: doomBucket.bucketName,
      DOOM_WASM_KEY: 'doom.wasm',
      DOOM_FRAME_KEY: 'doom-frame.png',
      DOOM_FRAMES_PER_SECOND: '5',
      DOOM_KEY_DB_TABLE_NAME: doomKeyDb.tableName,
    };
    this.s3DynamoDoomLambda = new NodejsFunction(this, 'S3DynamoDoomHandler', {
      entry: 'lib/lambda/s3-dynamo-doom.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      environment: s3DynamoDoomLambdaEnv,
      timeout: Duration.seconds(30),
      memorySize: 1024,
    });

    doomBucket.grantReadWrite(this.s3DynamoDoomLambda);
    doomKeyDb.grantReadWriteData(this.s3DynamoDoomLambda);
  }
}
