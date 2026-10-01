declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { readonly fatal?: boolean });
  decode(input?: Uint8Array): string;
}

interface SubtleCrypto {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

interface Crypto {
  readonly subtle: SubtleCrypto;
}

declare const crypto: Crypto;
