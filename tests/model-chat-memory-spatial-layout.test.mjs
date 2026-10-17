// Execute the owning TypeScript cases with the existing pinned library, without installation/build copies.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const prepared = process.env.BROWSER_MEMORY_GRAPH_DEPENDENCY_ROOT;
const headless = prepared
  ? pathToFileURL(resolve(prepared, '@ours/forcegraph-tsl/dist/headless/index.js'))
  : new URL('../.artifacts/memory/dependencies/@ours/forcegraph-tsl/dist/headless/index.js', import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@ours/forcegraph-tsl/headless') return nextResolve(headless.href, context);
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (source.protocol === 'file:' && existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
  }
  return nextResolve(specifier, context);
} });
await import('../modules/browser-rag-ts/tests/application/memoryGraphLayout.test.ts');
