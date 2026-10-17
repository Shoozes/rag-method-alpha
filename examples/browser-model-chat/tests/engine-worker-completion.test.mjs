import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Execute the actual reply branch with an injected engine and isolated Worker
// globals. Imports are replaced only in this test; no runtime/model is loaded.
const source = (await readFile(new URL('../engine-worker.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*?;\r?\n/gm, '')
  .replaceAll('import.meta.url', "'https://fixture.invalid/engine-worker.mjs'");

async function reply(chunks) {
  const posted = [], calls = [];
  const fixtureEngine = { isModelLoaded: () => true,
    async createChatCompletion(options) {
      calls.push(structuredClone(options));
      return (async function* () { for (const chunk of chunks) { if (chunk instanceof Error) throw chunk; yield chunk; } })();
    },
  };
  const self = { location: { href: 'https://fixture.invalid/engine-worker.mjs' },
    addEventListener() {}, postMessage: message => posted.push(structuredClone(message)) };
  runInNewContext(source + '\nengine = fixtureEngine;', { self, fixtureEngine,
    formatRuntimeError: value => value?.message || String(value), URL,
  });
  const messages = [{ role: 'user', content: 'Exact fixture input **raw**' }];
  await self.onmessage({ data: { id: 7, operation: 'reply', payload: { messages } } });
  assert.deepEqual(calls, [{ messages, stream: true, max_tokens: 160, temperature: 0 }]);
  return posted;
}
const token = content => ({ choices: [{ delta: { content }, finish_reason: null }] });

test('worker forwards native length and stop completion separately from exact accumulated text', async () => {
  for (const finish_reason of ['length', 'stop']) {
    const posted = await reply([token('**Raw'), token(' answer**'), { choices: [{ delta: {}, finish_reason }] }]);
    assert.deepEqual(posted, [
      { id: 7, type: 'token', value: '**Raw' }, { id: 7, type: 'token', value: '**Raw answer**' },
      { id: 7, type: 'completion', value: { finishReason: finish_reason, maxTokens: 160 } },
      { id: 7, type: 'result', value: '**Raw answer**' },
    ]);
  }
});

test('worker keeps missing and untrusted native finish reasons unknown for short and long answers', async () => {
  for (const content of ['Short.', 'Long fixture '.repeat(1000)]) {
    for (const finish_reason of [undefined, null, 'tool_calls', '<untrusted>', { reason: 'length' }]) {
      const posted = await reply([token(content), { choices: [{ delta: {}, finish_reason }] }]);
      assert.deepEqual(posted.at(-2), { id: 7, type: 'completion', value: { finishReason: 'unknown', maxTokens: 160 } });
      assert.equal(posted.at(-1).value, content);
    }
  }
});

test('empty and failed streams never emit successful completion metadata', async () => {
  for (const chunks of [[token(' ')], [token('Partial answer'), Error('Fixture native stream failure')]]) {
    const posted = await reply(chunks);
    assert.equal(posted.at(-1).type, 'error');
    assert.equal(posted.some(message => message.type === 'completion' || message.type === 'result'), false);
  }
});
