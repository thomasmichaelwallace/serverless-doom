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

export enum KeyEvent {
  KeyDown = 0,
  KeyUp = 1,
}

export type DoomKey = {
  ts: number,
  event: KeyEvent,
  keyCode: number,
};

export type DoomWindow = {
  savedState?: string,
};
