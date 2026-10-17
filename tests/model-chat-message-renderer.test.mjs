import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_RENDER_LIMITS, renderMessageContent, flushMessageContent } from '../examples/browser-model-chat/message-renderer.mjs';

// This adapter deliberately has no HTML parser, innerHTML or network surfaces.
// It asserts the renderer only creates its documented inert/semantic DOM nodes.
class TestNode {
  constructor(document, tag = null, text = '') { this.ownerDocument = document; this.tagName = tag; this.data = text; this.childNodes = []; this.attributes = {}; this.parentNode = null; this.replacements = 0; }
  append(...children) { for (const child of children) { assert.ok(child instanceof TestNode); child.parentNode = this; this.childNodes.push(child); } }
  replaceChildren(...children) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; this.append(...children); this.replacements++; }
  setAttribute(name, value) { assert.ok(['href', 'target', 'rel', 'referrerpolicy', 'start', 'data-language', 'tabindex', 'role', 'aria-label'].includes(name)); this.attributes[name] = value; }
  get textContent() { return this.tagName === null ? this.data : this.childNodes.map(child => child.textContent).join(''); }
  set innerHTML(_) { assert.fail('Message rendering must never use innerHTML.'); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
}
function fixture() {
  const document = {
    selection: null,
    createTextNode(text) { return new TestNode(this, null, text); },
    createElement(tag) { assert.ok(['div', 'p', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'a'].includes(tag)); return new TestNode(this, tag); },
    getSelection() { return this.selection; },
  };
  return { document, container: document.createElement('div') };
}
const tags = node => node.childNodes.filter(child => child.tagName).map(child => child.tagName);
const descendants = (node, tag) => node.childNodes.flatMap(child => [...(child.tagName === tag ? [child] : []), ...descendants(child, tag)]);
const markdown = (container, text, options = {}) => renderMessageContent(container, text, { markdown: true, ...options });

test('plain user content stays byte-for-byte literal, including markup, entities and CRLF', () => {
  const { container } = fixture(), source = '**user**\r\n<script>alert(1)</script> &lt;tag&gt; [x](https://example.com)';
  assert.deepEqual(renderMessageContent(container, source), { rendered: true, deferred: false, markdown: false, limited: false });
  assert.equal(container.textContent, source); assert.deepEqual(tags(container), []);
});

test('paragraphs, nested distinct emphasis and escaped delimiters use semantic DOM', () => {
  const { container } = fixture();
  markdown(container, 'First **strong with _em_** and *soft*.\nSame paragraph.\n\nEscaped \\*stars\\* and word_part_here.');
  assert.deepEqual(tags(container), ['p', 'p']);
  assert.deepEqual(descendants(container, 'strong').map(node => node.textContent), ['strong with em']);
  assert.deepEqual(descendants(container, 'em').map(node => node.textContent), ['em', 'soft']);
  assert.equal(container.childNodes[1].textContent, 'Escaped *stars* and word_part_here.');
});

test('flat unordered and ordered lists keep block boundaries and their explicit starting number', () => {
  const { container } = fixture();
  markdown(container, 'Intro\n- **one**\n+ two\n\n3. three\n4) four\n\nEnd');
  assert.deepEqual(tags(container), ['p', 'ul', 'ol', 'p']);
  assert.deepEqual(descendants(container, 'li').map(node => node.textContent), ['one', 'two', 'three', 'four']);
  assert.deepEqual(descendants(container, 'ol')[0].attributes, { start: '3' });
});

test('inline code is inert and longer tick delimiters contain literal shorter runs', () => {
  const { container } = fixture();
  markdown(container, '`<img src=x onerror=alert(1)>` and ``a ` b **literal**`` and *outside `*` safe*.');
  assert.deepEqual(descendants(container, 'code').map(node => node.textContent), ['<img src=x onerror=alert(1)>', 'a ` b **literal**', '*']);
  assert.equal(descendants(container, 'em')[0].textContent, 'outside * safe');
  assert.equal(descendants(container, 'a').length, 0);
});

test('fenced code does not interpret HTML, links or Markdown and accepts a safe language hint', () => {
  const { container } = fixture();
  markdown(container, 'Before\n```js\n<script>bad()</script>\n**literal** [x](https://example.com)\n```\nAfter');
  assert.deepEqual(tags(container), ['p', 'pre', 'p']);
  assert.deepEqual(descendants(container, 'pre')[0].attributes, { tabindex: '0', role: 'region', 'aria-label': 'Code block' });
  assert.equal(descendants(container, 'code')[0].textContent, '<script>bad()</script>\n**literal** [x](https://example.com)\n');
  assert.deepEqual(descendants(container, 'code')[0].attributes, { 'data-language': 'js' });
  assert.equal(descendants(container, 'a').length, 0); assert.equal(descendants(container, 'strong').length, 0);
});

test('partial streamed fences and delimiters remain safe through completion', () => {
  const { container } = fixture();
  for (const source of ['`', '``', '```', '```js\n', '```js\n<img onerror=x>', '```js\n<img onerror=x>\n```']) {
    markdown(container, source, { streaming: true });
    assert.equal(descendants(container, 'a').length, 0);
    if (source.includes('\n')) assert.deepEqual(tags(container), ['pre']);
  }
  for (const source of ['*open', '**open', '_open', '__open', '[label](https://', '[label](javascript:bad())']) {
    markdown(container, source, { streaming: true }); assert.equal(container.textContent, source);
    assert.equal(descendants(container, 'strong').length + descendants(container, 'em').length + descendants(container, 'a').length, 0);
  }
  markdown(container, '**closed**'); assert.equal(descendants(container, 'strong')[0].textContent, 'closed');
});

test('only explicit absolute HTTP/HTTPS links become anchors without opener or referrer access', () => {
  const { container } = fixture();
  markdown(container, '[**Safe** site](https://example.com/a_(b)?q=1&x=2) and [HTTP](http://example.org/)');
  const links = descendants(container, 'a'); assert.equal(links.length, 2);
  assert.equal(links[0].textContent, 'Safe site'); assert.equal(descendants(links[0], 'strong').length, 1);
  assert.deepEqual(links[0].attributes, { href: 'https://example.com/a_(b)?q=1&x=2', target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' });
  assert.equal(links[1].attributes.href, 'http://example.org/');
});

test('dangerous, credentialed, relative, obfuscated and malformed URLs remain literal', () => {
  const targets = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<svg/onload=alert(1)>', 'vbscript:bad', '//example.com', '/relative', '#source',
    'https://user:pass@example.com/', 'https://user@example.com/', 'https://example.com/\\evil', 'https://example.com/ path', 'https://example.com/\u0000bad',
    'https:\\example.com', 'javascript&#58;alert(1)', 'java\tscript:bad', 'https://example.com "title"', '<https://example.com>', 'https://'];
  for (const target of targets) {
    const { container } = fixture(), source = `[label](${target})`;
    markdown(container, source); assert.equal(descendants(container, 'a').length, 0, target); assert.equal(container.textContent, source, target);
  }
});

test('HTML, entities, images, autolinks and unsupported headings/tables stay inert text', () => {
  const { container } = fixture();
  const source = '<script>alert(1)</script> &lt;img&gt;\n![image](https://example.com/tracker.png)\n<https://example.com>\nhttps://example.com\n# Heading\n| A | B |';
  markdown(container, source); assert.equal(container.textContent, source);
  assert.deepEqual(tags(container), ['p']); assert.equal(descendants(container, 'a').length, 0);
});

test('malformed nested labels and unsupported delimiter runs never generate malformed DOM', () => {
  const { container } = fixture();
  for (const source of ['***triple***', '[outer [inner](https://example.com)](https://example.org)', '** spaced **', '* spaced *', '_a_b_', '```bad language\ntext', '[unfinished']) {
    assert.doesNotThrow(() => markdown(container, source));
    assert.equal(descendants(container, 'a').some(node => descendants(node, 'a').length), false);
    assert.equal(descendants(container, 'pre').some(node => descendants(node, 'p').length), false);
  }
});

test('nested and unfinished link syntax stays wholly literal instead of activating an inner link', () => {
  const { container } = fixture();
  for (const source of ['[outer [inner](https://example.com)](https://example.org)', '[outer [inner](https://example.com)', '![outer [inner](https://example.com)](https://example.org)', '[open **partial**']) {
    markdown(container, source); assert.equal(container.textContent, source);
    assert.equal(descendants(container, 'a').length, 0); assert.equal(descendants(container, 'strong').length, 0);
  }
});

test('character, line, node and scan limits fall back atomically to the full literal source', () => {
  const sources = [
    '*'.repeat(MESSAGE_RENDER_LIMITS.characters + 1),
    'line\n'.repeat(MESSAGE_RENDER_LIMITS.lines),
    '- **x**\n'.repeat(1_400),
    Array.from({ length: 16 }, (_, index) => '`'.repeat(index + 1)).join(' ') + 'a'.repeat(25_000),
  ];
  for (const source of sources) {
    const { container } = fixture();
    const result = markdown(container, source); assert.equal(result.limited, true, `Bounded fallback for ${source.length} characters.`);
    assert.equal(container.textContent, source); assert.deepEqual(tags(container), []); assert.equal(container.replacements, 1);
  }
});

test('long ordinary text and unmatched punctuation need no scanning fallback', () => {
  const { container } = fixture();
  for (const source of ['['.repeat(4_000), '`'.repeat(1_000) + 'a'.repeat(60_000)]) {
    assert.equal(markdown(container, source).limited, false); assert.equal(container.textContent, source);
  }
});

test('selection defers streaming and final rendering, retaining only the latest request until flush', () => {
  const { container, document } = fixture();
  markdown(container, '**First**'); const selected = descendants(container, 'strong')[0].childNodes[0];
  document.selection = { isCollapsed: false, rangeCount: 1, anchorNode: selected, focusNode: selected };
  assert.equal(markdown(container, '**Second**', { streaming: true }).deferred, true);
  assert.equal(markdown(container, '**Latest**').deferred, true);
  assert.equal(container.textContent, 'First'); assert.equal(container.replacements, 1);
  assert.equal(flushMessageContent(container).deferred, true);
  document.selection = { isCollapsed: true, rangeCount: 1, anchorNode: selected, focusNode: selected };
  assert.deepEqual(flushMessageContent(container), { rendered: true, deferred: false, markdown: true, limited: false });
  assert.equal(container.textContent, 'Latest'); assert.equal(container.replacements, 2);
  assert.equal(flushMessageContent(container).rendered, false);
});

test('selection crossing the container is protected and an unrelated selection is not', () => {
  const { container, document } = fixture(); markdown(container, 'Original');
  document.selection = { isCollapsed: false, rangeCount: 1, anchorNode: {}, focusNode: {}, getRangeAt() { return { intersectsNode: node => node === container }; } };
  assert.equal(markdown(container, 'Deferred').deferred, true);
  document.selection.getRangeAt = () => ({ intersectsNode: () => false });
  assert.equal(flushMessageContent(container).rendered, true); assert.equal(container.textContent, 'Deferred');
});

test('duplicate requests avoid DOM churn and reverting a pending update cancels it', () => {
  const { container, document } = fixture(); markdown(container, '**Original**');
  document.selection = { isCollapsed: false, rangeCount: 1, anchorNode: container, focusNode: container };
  assert.equal(markdown(container, 'Pending').deferred, true);
  assert.equal(markdown(container, '**Original**').deferred, false);
  document.selection = null; assert.equal(flushMessageContent(container).rendered, false); assert.equal(container.replacements, 1);
  assert.equal(markdown(container, '**Original**', { streaming: true }).rendered, false);
});

test('plain versus Markdown mode can change without losing or modifying the input string', () => {
  const { container } = fixture(), source = '**Exact** &amp;';
  markdown(container, source); assert.equal(container.textContent, 'Exact &amp;');
  renderMessageContent(container, source); assert.equal(container.textContent, source); assert.equal(source, '**Exact** &amp;');
  assert.deepEqual(tags(container), []);
});

test('null, empty and invalid-container requests have a small explicit contract', () => {
  const { container } = fixture();
  renderMessageContent(container, null); assert.equal(container.textContent, '');
  markdown(container, ''); assert.equal(container.textContent, ''); assert.deepEqual(tags(container), []);
  assert.throws(() => renderMessageContent(null, 'x'), TypeError);
});
