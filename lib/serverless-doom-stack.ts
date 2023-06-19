import { Stack, StackProps } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export default class ServerlessDoomStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handler = new NodejsFunction(this, 'HelloDoomHandler', {
      entry: 'lib/lambda/hello-doom.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
    });
  }
}
