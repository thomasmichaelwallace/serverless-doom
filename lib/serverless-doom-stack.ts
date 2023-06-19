import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export default class ServerlessDoomStack extends Stack {
  helloDoomLambda: NodejsFunction;

  s3DynamoDoomLambda: NodejsFunction;

  kvDoomLambda: NodejsFunction;

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

    const kvDoomLambdaEnv = {
      DOOM_BUCKET_NAME: doomBucket.bucketName,
      DOOM_PHOTO_KEY: 'doom-screenshot.png',
    };
    this.kvDoomLambda = new NodejsFunction(this, 'KvDoomHandler', {
      entry: 'lib/lambda/kv-doom.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(30),
      memorySize: 1024 * 3,
      environment: kvDoomLambdaEnv,
      bundling: {
        nodeModules: ['@sparticuz/chromium', 'vm2'],
        commandHooks: {
          beforeBundling(): string[] {
            return ['npm run build:kv']; // rebuild dist
          },
          beforeInstall(): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            if (inputDir === '/asset-input') return [];
            const localDist = path.join(inputDir, 'dist');
            const bundleDist = path.join(outputDir, 'dist');
            return [
              `mkdir -p ${bundleDist}`,
              `cp -r ${localDist} ${outputDir}`,
            ];
          },
        },
      },
    });

    const account = props?.env?.account;
    this.kvDoomLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kinesisvideo:*'],
      resources: [
        `arn:aws:kinesisvideo:eu-west-1:${account || '*'}:channel/tom-test-channel/1685732429083`,
      ],
      effect: iam.Effect.ALLOW,
      sid: 'KinesisVideoAccess',
    }));
    doomBucket.grantReadWrite(this.kvDoomLambda);
    doomKeyDb.grantReadWriteData(this.kvDoomLambda);
  }
}
