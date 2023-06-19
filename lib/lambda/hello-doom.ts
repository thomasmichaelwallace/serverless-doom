import { Handler } from 'aws-lambda';

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

// eslint-disable-next-line import/prefer-default-export
export const handler: Handler = async (event, context) => {
  /* eslint-disable no-console */
  console.log('Hello Doom!');
  console.log('event', event);
  console.log('context', context);

  await delay(10);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello Doom!',
    }),
  };
};
