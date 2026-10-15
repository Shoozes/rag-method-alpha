export const MODEL = Object.freeze({
  id: 'LiquidAI/LFM2.5-230M-GGUF',
  file: 'LFM2.5-230M-Q4_K_M.gguf',
  revision: 'fa224d4cb60cffe61eb58726712ef255bb64d0b7',
  bytes: 153406304,
  sha256: '7bbd90384d3deffe4c646ec9643b212802d32d4ce417c90a1ec9282100650062',
  url: 'https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/resolve/fa224d4cb60cffe61eb58726712ef255bb64d0b7/LFM2.5-230M-Q4_K_M.gguf',
  license: 'https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/blob/fa224d4cb60cffe61eb58726712ef255bb64d0b7/LICENSE',
});

export const RUNTIME = Object.freeze({
  version: '3.5.1',
  tarball: 'https://registry.npmjs.org/@wllama/wllama/-/wllama-3.5.1.tgz',
  integrity: 'm5L0KKtmUTKz5lGvVVa/Y3qRtoobu80Jne51U0CSR6O930aOUURzhMEAolNsN4v0kfQ9u58wi2IdpUicLfaXUw==',
  files: Object.freeze({
    'index.js': { entry: 'package/esm/index.js', sha256: '2ed031e8d61cebd1d4c7d4956a6350f5afc7fa7c678c3a324d66f6df958f67db' },
    'wllama.wasm': { entry: 'package/esm/wasm/wllama.wasm', sha256: '4197ce6d3dc9240c42ee52b4197dc99638875a06b0083901f8a57767338a0cfa' },
    LICENSE: { entry: 'package/LICENCE', sha256: '5866e3bd7e3cbd3f7c8bea6efd8a1e7fa7cc8de68c30f428aff7c6584a0fb720' },
  }),
});

export const COMPAT = Object.freeze({
  package: '@wllama/wllama-compat',
  version: '3.5.1',
  tarball: 'https://registry.npmjs.org/@wllama/wllama-compat/-/wllama-compat-3.5.1.tgz',
  integrity: 'eWFeyLmAgshNsT4eti7El4F0Iip1/Gt/vn5thAhezFoRS8vkC2YjXRMAGmwHRttTWz+7u21f1Me/A70La1TgyA==',
  gitHead: '912c18b75d4358c1405a64646b8dbe43a205943b',
  files: Object.freeze({
    'compat/wllama.js': { entry: 'package/wasm/wllama.js', bytes: 166823, sha256: '011e11f2c2a4a94d1764a4f45993e01ae5c48f72d78d59464972b26606afd6ac' },
    'compat/wllama.wasm': { entry: 'package/wasm/wllama.wasm', bytes: 14186308, sha256: '9ea153d9396db12c385d53e9a8330b1638ca3e8805159a762ce8859d92d2ac8b' },
  }),
});
