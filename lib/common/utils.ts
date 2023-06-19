// eslint-disable-next-line import/prefer-default-export
export function delay(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
