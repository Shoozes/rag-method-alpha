import { decodeUtf8 } from "../shared/utf8.js";

export function decodeSource(value: Uint8Array): string {
  return decodeUtf8(value, "content");
}
