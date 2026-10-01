import { ContractError } from "./errors.js";
import { assertValidUnicodeScalars } from "./unicode.js";

export function encodeUtf8(value: string, fieldName = "value"): Uint8Array {
  assertValidUnicodeScalars(value, fieldName);
  return new TextEncoder().encode(value);
}

export function decodeUtf8(value: Uint8Array, fieldName = "content"): string {
  if (!(value instanceof Uint8Array)) throw new ContractError(`${fieldName} must be a byte array`);
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
    assertValidUnicodeScalars(decoded, fieldName);
    return decoded;
  } catch (error) {
    throw new ContractError(`${fieldName} must contain valid UTF-8`, "invalid_utf8");
  }
}
