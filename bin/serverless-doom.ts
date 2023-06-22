#!/usr/bin/env node

/* eslint-disable no-new */
import * as cdk from 'aws-cdk-lib';
import ServerlessDoomStack from '../lib/serverless-doom-stack';
import context from '../tmp/context.json';

const app = new cdk.App();
new ServerlessDoomStack(app, 'ServerlessDoomStack', { env: { region: context.region } });
