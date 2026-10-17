// A deliberately small Markdown subset, not a CommonMark implementation. All
// message-derived content goes through text nodes; no HTML parser is involved.
// Raw messages remain the caller's source of truth for storage, prompts and copy.
export const MESSAGE_RENDER_LIMITS = Object.freeze({ characters: 65_536, lines: 2_048, nodes: 4_096, depth: 8, steps: 262_144 });

const states = new WeakMap();
const limitReached = Symbol('message-render-limit');
const word = /[\p{L}\p{N}]/u;
const whitespace = /\s/u;
const escapable = '\\`*_[]()!<>'.split('');

function budget() {
  let remaining = MESSAGE_RENDER_LIMITS.steps, nodes = 0;
  return {
    step(count = 1) { remaining -= count; if (remaining < 0) throw limitReached; },
    node() { if (++nodes > MESSAGE_RENDER_LIMITS.nodes) throw limitReached; },
  };
}

function textNode(document, text, work) {
  work.node();
  return document.createTextNode(text);
}

function element(document, tag, work) {
  work.node();
  return document.createElement(tag);
}

function runLength(text, at, marker, end, work) {
  let next = at;
  while (next < end && text[next] === marker) { work.step(); next++; }
  return next - at;
}

function codeEnd(text, from, end, width, work) {
  for (let at = from; at < end;) {
    work.step();
    if (text[at] !== '`') { at++; continue; }
    const count = runLength(text, at, '`', end, work);
    if (count === width) return at;
    at += count;
  }
  return -1;
}

function delimiterOpens(text, at, width, start, end) {
  const after = text[at + width], before = at > start ? text[at - 1] : '';
  return Boolean(after) && !whitespace.test(after)
    && !(text[at] === '_' && word.test(before) && word.test(after));
}

function delimiterCloses(text, at, width, start, end) {
  const before = at > start ? text[at - 1] : '', after = at + width < end ? text[at + width] : '';
  return Boolean(before) && !whitespace.test(before)
    && !(text[at] === '_' && word.test(before) && word.test(after));
}

function delimiterEnd(text, from, end, marker, width, start, work) {
  for (let at = from; at < end;) {
    work.step();
    if (text[at] === '\\') { at += Math.min(2, end - at); continue; }
    if (text[at] === '`') {
      const count = runLength(text, at, '`', end, work);
      const close = codeEnd(text, at + count, end, count, work);
      if (close !== -1) { at = close + count; continue; }
      at += count; continue;
    }
    if (text[at] !== marker) { at++; continue; }
    const count = runLength(text, at, marker, end, work);
    if (count === width && delimiterCloses(text, at, width, start, end)) return at;
    at += count;
  }
  return -1;
}

function safeLink(target, work) {
  work.step(target.length);
  // No relative, protocol-relative, encoded/whitespace-obfuscated scheme,
  // credentials, backslash normalization, HTML entities or Markdown titles.
  if (target.length > 2_048 || !/^https?:\/\//i.test(target)
    || /[\u0000-\u0020\u007f-\u009f\\<>]/u.test(target)) return null;
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function linkAt(text, at, end, work) {
  const literal = finish => ({ end: finish, href: null });
  let close = at + 1, brackets = 0, nestedLabel = false;
  for (; close < end; close++) {
    work.step();
    if (text[close] === '\\') { close++; continue; }
    if (text[close] === '\n') return literal(close);
    if (text[close] === '[') { nestedLabel = true; if (++brackets > 4) return literal(end); }
    if (text[close] === ']') { if (brackets === 0) break; brackets--; }
  }
  if (close === end) return literal(end);
  if (close === at + 1 || text[close + 1] !== '(') return literal(close + 1);
  let nesting = 0, finish = close + 2;
  for (; finish < end; finish++) {
    work.step();
    if (text[finish] === '\\') { finish++; continue; }
    if (text[finish] === '\n') return literal(finish);
    if (text[finish] === '(' && ++nesting > 4) return literal(end);
    if (text[finish] === ')') { if (nesting === 0) break; nesting--; }
  }
  if (finish === end) return literal(end);
  return { end: finish + 1, labelStart: at + 1, labelEnd: close, href: nestedLabel ? null : safeLink(text.slice(close + 2, finish), work) };
}

function inline(document, parent, text, start, end, work, depth = 0, allowLinks = true) {
  if (depth > MESSAGE_RENDER_LIMITS.depth) throw limitReached;
  let plainStart = start, at = start;
  const flush = finish => { if (finish > plainStart) parent.append(textNode(document, text.slice(plainStart, finish), work)); };
  while (at < end) {
    work.step();
    const marker = text[at];
    if (marker === '\\' && at + 1 < end && escapable.includes(text[at + 1])) {
      flush(at); parent.append(textNode(document, text[at + 1], work)); at += 2; plainStart = at; continue;
    }
    if (marker === '`') {
      const width = runLength(text, at, marker, end, work);
      const close = codeEnd(text, at + width, end, width, work);
      if (close !== -1) {
        flush(at);
        const code = element(document, 'code', work);
        code.append(textNode(document, text.slice(at + width, close), work)); parent.append(code);
        at = close + width; plainStart = at; continue;
      }
      at += width; continue;
    }
    const image = marker === '!' && text[at + 1] === '[';
    if (allowLinks && (marker === '[' || image)) {
      const link = linkAt(text, at + Number(image), end, work);
      if (link) {
        flush(at);
        if (!image && link.href) {
          const anchor = element(document, 'a', work);
          anchor.setAttribute('href', link.href); anchor.setAttribute('target', '_blank');
          anchor.setAttribute('rel', 'noopener noreferrer'); anchor.setAttribute('referrerpolicy', 'no-referrer');
          inline(document, anchor, text, link.labelStart, link.labelEnd, work, depth + 1, false); parent.append(anchor);
        } else parent.append(textNode(document, text.slice(at, link.end), work));
        at = link.end; plainStart = at; continue;
      }
    }
    if (marker === '*' || marker === '_') {
      const width = runLength(text, at, marker, end, work);
      if (width <= 2 && delimiterOpens(text, at, width, start, end)) {
        const close = delimiterEnd(text, at + width, end, marker, width, start, work);
        if (close !== -1) {
          flush(at);
          const emphasis = element(document, width === 2 ? 'strong' : 'em', work);
          inline(document, emphasis, text, at + width, close, work, depth + 1, allowLinks); parent.append(emphasis);
          at = close + width; plainStart = at; continue;
        }
      }
      at += width; continue;
    }
    at++;
  }
  flush(end);
}

function fenceAt(line) {
  let at = 0;
  while (line[at] === ' ' && at < 3) at++;
  const marker = line[at];
  if (marker !== '`' && marker !== '~') return null;
  let finish = at;
  while (line[finish] === marker) finish++;
  const width = finish - at, language = line.slice(finish).trim();
  if (width < 3 || width > 32 || (language && !/^[A-Za-z][A-Za-z0-9_+-]{0,31}$/.test(language))) return null;
  return { marker, width, language };
}

function closesFence(line, fence) {
  let at = 0;
  while (line[at] === ' ' && at < 3) at++;
  let finish = at;
  while (line[finish] === fence.marker) finish++;
  return finish - at >= fence.width && line.slice(finish).trim() === '';
}

function listAt(line) {
  const unordered = /^[-+*] +(.*)$/.exec(line);
  if (unordered) return { tag: 'ul', value: unordered[1] };
  const ordered = /^(\d{1,9})[.)] +(.*)$/.exec(line);
  return ordered ? { tag: 'ol', start: Number(ordered[1]), value: ordered[2] } : null;
}

function markdownNodes(document, source) {
  if (source.length > MESSAGE_RENDER_LIMITS.characters) throw limitReached;
  const work = budget(), lines = source.replace(/\r\n?/g, '\n').split('\n'), nodes = [];
  if (lines.length > MESSAGE_RENDER_LIMITS.lines) throw limitReached;
  for (let at = 0; at < lines.length;) {
    work.step(lines[at].length + 1);
    if (lines[at].trim() === '') { at++; continue; }
    const fence = fenceAt(lines[at]);
    if (fence) {
      const first = ++at;
      while (at < lines.length && !closesFence(lines[at], fence)) { work.step(lines[at].length + 1); at++; }
      let content = lines.slice(first, at).join('\n');
      if (at < lines.length && at > first) content += '\n';
      const pre = element(document, 'pre', work), code = element(document, 'code', work);
      pre.setAttribute('tabindex', '0'); pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', 'Code block');
      if (fence.language) code.setAttribute('data-language', fence.language);
      code.append(textNode(document, content, work)); pre.append(code); nodes.push(pre);
      if (at < lines.length) at++;
      continue;
    }
    const item = listAt(lines[at]);
    if (item) {
      const list = element(document, item.tag, work);
      if (item.tag === 'ol' && item.start !== 1) list.setAttribute('start', String(item.start));
      while (at < lines.length) {
        const next = listAt(lines[at]);
        if (!next || next.tag !== item.tag) break;
        const li = element(document, 'li', work);
        inline(document, li, next.value, 0, next.value.length, work); list.append(li); at++;
      }
      nodes.push(list); continue;
    }
    const first = at++;
    while (at < lines.length && lines[at].trim() !== '' && !fenceAt(lines[at]) && !listAt(lines[at])) { work.step(lines[at].length + 1); at++; }
    const paragraph = element(document, 'p', work), content = lines.slice(first, at).join('\n');
    inline(document, paragraph, content, 0, content.length, work); nodes.push(paragraph);
  }
  return nodes;
}

function selectedInside(container) {
  const document = container.ownerDocument;
  let selection;
  try { selection = document.getSelection?.() ?? document.defaultView?.getSelection?.(); }
  catch { return false; }
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  if (container.contains?.(selection.anchorNode) || container.contains?.(selection.focusNode)) return true;
  for (let index = 0; index < selection.rangeCount; index++) {
    try { if (selection.getRangeAt(index).intersectsNode(container)) return true; }
    catch { /* A detached or obsolete range cannot intersect this live content. */ }
  }
  return false;
}

// The host owns one selectionchange listener and calls flushMessageContent for
// deferred containers. Keeping the latest request in a WeakMap avoids retaining
// removed transcript elements. Selection protection includes the final frame.
export function renderMessageContent(container, text, { markdown = false, streaming = false } = {}) {
  if (!container?.ownerDocument || typeof container.replaceChildren !== 'function') throw new TypeError('A message DOM container is required.');
  const request = { text: String(text ?? ''), markdown: Boolean(markdown), streaming: Boolean(streaming) };
  const state = states.get(container) || { current: null, pending: null };
  states.set(container, state);
  if (state.current?.text === request.text && state.current.markdown === request.markdown) {
    state.pending = null;
    return { rendered: false, deferred: false, markdown: request.markdown, limited: state.current.limited };
  }
  if (selectedInside(container)) {
    state.pending = request;
    return { rendered: false, deferred: true, markdown: request.markdown, limited: false };
  }
  let nodes, limited = false;
  if (request.markdown) {
    try { nodes = markdownNodes(container.ownerDocument, request.text); }
    catch (error) { if (error !== limitReached) throw error; limited = true; }
  }
  if (!nodes) nodes = [container.ownerDocument.createTextNode(request.text)];
  container.replaceChildren(...nodes);
  state.current = { ...request, limited }; state.pending = null;
  return { rendered: true, deferred: false, markdown: request.markdown, limited };
}

export function flushMessageContent(container) {
  const state = states.get(container);
  if (state?.pending) return renderMessageContent(container, state.pending.text, state.pending);
  return { rendered: false, deferred: false, markdown: state?.current?.markdown ?? false, limited: state?.current?.limited ?? false };
}
