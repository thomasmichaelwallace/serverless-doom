#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ServerlessDoomStack } from '../lib/serverless-doom-stack';

const app = new cdk.App();
new ServerlessDoomStack(app, 'ServerlessDoomStack');
