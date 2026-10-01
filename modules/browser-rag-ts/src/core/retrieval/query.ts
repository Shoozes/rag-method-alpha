import { ContractError } from "../shared/errors.js";
import { encodeUtf8 } from "../shared/utf8.js";
import { unicodeScalarCount } from "../shared/unicode.js";
import { MAX_QUERY_CHARS, MAX_QUERY_UTF8_BYTES } from "../shared/types.js";

export function validateQuery(value: unknown, maxChars = MAX_QUERY_CHARS, maxBytes = MAX_QUERY_UTF8_BYTES): string {
  if (typeof value !== "string") throw new ContractError("query must be a string");
  if (unicodeScalarCount(value) > maxChars) throw new ContractError("query exceeds the configured character limit");
  if (encodeUtf8(value).byteLength > maxBytes) throw new ContractError("query exceeds the configured UTF-8 byte limit");
  return value;
}
