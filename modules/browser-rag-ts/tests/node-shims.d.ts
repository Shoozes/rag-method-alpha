declare module "node:test" {
  export default function test(name: string, callback: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(callback: () => unknown, expected?: unknown): void;
    rejects(promise: Promise<unknown>, expected?: unknown): Promise<void>;
    ok(value: unknown, message?: string): void;
  };
  export default assert;
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
}

declare const process: { cwd(): string };
