import { encodeUtf8 } from "./utf8.js";

export async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Text(value: string): Promise<string> {
  return sha256(encodeUtf8(value));
}

export async function canonicalHash(parts: readonly string[]): Promise<string> {
  const encoded = parts.map((part) => encodeUtf8(part));
  const size = encoded.reduce((total, part) => total + 8 + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const part of encoded) {
    view.setBigUint64(offset, BigInt(part.byteLength), true);
    offset += 8;
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return sha256(bytes);
}
