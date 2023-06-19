import type { KeyCodes, KeyEvent } from './doom';

export type AwsCredentials = {
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
};

export type CliTmpCredentials = {
  Credentials: {
    AccessKeyId: string,
    SecretAccessKey: string,
    SessionToken?: string,
  }
};

export type DoomKey = {
  ts: number,
  event: KeyEvent,
  keyCode: keyof typeof KeyCodes,
};
