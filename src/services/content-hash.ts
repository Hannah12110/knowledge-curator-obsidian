export async function sha256Text(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  return sha256Bytes(encoded);
}

export async function sha256Bytes(content: ArrayBuffer | ArrayBufferView): Promise<string> {
  const source = content instanceof ArrayBuffer
    ? new Uint8Array(content)
    : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
