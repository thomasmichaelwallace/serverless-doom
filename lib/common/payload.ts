/* eslint-disable */

// typescript and eslint ignore everything in this file:
// It is causing a lot of issues because CompressionStream and
// DecompressionStream are not defined in the typescript lib.

const uint8ToBase64 = (arr: Uint8Array): string => btoa(
  Array(arr.length)
    .fill('')
    .map((_, i) => String.fromCharCode(arr[i]))
    .join(''),
);
const base64ToUint8 = (str: string): Uint8Array => Uint8Array
  .from(atob(str), (c) => c.charCodeAt(0));

async function compressArrayBuffer(input: ArrayBuffer) {
  // @ts-ignore
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const output = [];
  const reader = cs.readable.getReader();
  let totalSize = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) { break; }
    output.push(value);
    totalSize += value.byteLength;
  }
  const concatenated = new Uint8Array(totalSize);
  let offset = 0;
  for (const array of output) {
    concatenated.set(array, offset);
    offset += array.byteLength;
  }
  return concatenated;
}

async function decompressArrayBuffer(input: ArrayBuffer) {
  // @ts-ignore
  const cs = new DecompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const output = [];
  const reader = cs.readable.getReader();
  let totalSize = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) { break; }
    output.push(value);
    totalSize += value.byteLength;
  }
  const concatenated = new Uint8Array(totalSize);
  let offset = 0;
  for (const array of output) {
    concatenated.set(array, offset);
    offset += array.byteLength;
  }
  return concatenated;
}

export async function getSaveCode(memory: Uint8Array): Promise<string> {
  return uint8ToBase64(await compressArrayBuffer(memory));
}

export async function fromSaveCode(saveCode: string): Promise<Uint8Array> {
  return decompressArrayBuffer(base64ToUint8(saveCode));
}
