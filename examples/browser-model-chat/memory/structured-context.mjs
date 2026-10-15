// Derived context only. Explicit user declarations do not become saved facts.
const strategy = 'source-linked-structured-extractive-v1';
const notice = 'Only explicitly marked user lines retained; incomplete derived context, not independently verified; original transcript preserved.';
const declaration = /^(Fact|Constraint|Correction)\[([A-Za-z][A-Za-z0-9_.-]{0,39})\]:[ \t]*(.*)$/;
const countPoints = text => [...text].length;
const error = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = message => error('STRUCTURED_CONTEXT_INVALID', message);

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function lines(text) {
  const result = [];
  for (let start = 0; start < text.length;) {
    let end = start;
    while (end < text.length && text[end] !== '\r' && text[end] !== '\n') end++;
    result.push({ quote: text.slice(start, end), offsets: { start, end, unit: 'utf16' } });
    start = end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
  }
  return result;
}

/** Retain every active marked declaration or fail; never silently truncate it. */
export async function extractStructuredContext(turns, { protectedTurnIds = [], hashText,
  maxItems = 24, maxItemCodepoints = 480, maxTotalCodepoints = 1800 } = {}) {
  if (!Array.isArray(turns) || typeof hashText !== 'function') invalid('Canonical turns and a SHA-256 hashText function are required.');
  for (const limit of [maxItems, maxItemCodepoints, maxTotalCodepoints]) {
    if (!Number.isSafeInteger(limit) || limit < 1) invalid('Structured context limits must be positive integers.');
  }
  if (!(Array.isArray(protectedTurnIds) || protectedTurnIds instanceof Set)
    || [...protectedTurnIds].some(id => typeof id !== 'string' || !id)) invalid('Protected source turn IDs must be explicit identities.');
  const protectedIds = new Set(protectedTurnIds), turnIds = new Set(), active = new Map();
  const omittedUnmarkedTurns = new Set();
  const coverage = { inputTurnCount: turns.length, eligibleUserTurnCount: 0, protectedTurnCount: 0,
    ignoredAssistantTurnCount: 0, declaredLineCount: 0, correctionLineCount: 0, deduplicatedLineCount: 0,
    omittedUnmarkedLineCount: 0, omittedUnmarkedTurnCount: 0 };
  for (const turn of turns) {
    if (!turn || typeof turn.id !== 'string' || !turn.id || turnIds.has(turn.id)
      || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string') invalid('Expected distinct canonical user/assistant turns with text.');
    turnIds.add(turn.id);
    if (protectedIds.has(turn.id)) coverage.protectedTurnCount++;
    if (turn.role === 'assistant') { coverage.ignoredAssistantTurnCount++; continue; }
    if (protectedIds.has(turn.id)) continue;
    coverage.eligibleUserTurnCount++;
    for (const line of lines(turn.content)) {
      const match = declaration.exec(line.quote);
      if (!match) {
        if (/^(?:Fact|Constraint|Correction)\[/.test(line.quote)) invalid(`Malformed structured declaration in ${turn.id}; use Fact[key]: value, Constraint[key]: value or Correction[key]: value.`);
        if (line.quote.trim()) { coverage.omittedUnmarkedLineCount++; omittedUnmarkedTurns.add(turn.id); }
        continue;
      }
      const [, marker, suppliedKey, rawValue] = match, key = suppliedKey.toLowerCase(), value = rawValue.trim();
      if (!value) invalid(`Structured declaration ${key} in ${turn.id} needs a nonempty value.`);
      coverage.declaredLineCount++;
      const reference = { turnId: turn.id, offsets: line.offsets, quote: line.quote, marker };
      const previous = active.get(key);
      if (marker === 'Correction') {
        coverage.correctionLineCount++;
        if (!previous) error('STRUCTURED_CONTEXT_UNKNOWN_CORRECTION', `Correction[${key}] has no earlier eligible Fact or Constraint. Add the explicit original declaration or correct its key.`);
        if (previous.quote === line.quote) {
          previous.references.push(reference); previous.lineage.push(reference); coverage.deduplicatedLineCount++;
        } else {
          active.set(key, { key, kind: previous.kind, value, quote: line.quote, reference,
            references: [reference], lineage: [...previous.lineage, reference] });
        }
      } else {
        const kind = marker.toLowerCase();
        if (previous && (previous.kind !== kind || previous.value !== value)) {
          error('STRUCTURED_CONTEXT_CONFLICT', `Conflicting declaration for ${key} in ${turn.id}; use Correction[${key}] explicitly instead of choosing a value implicitly.`);
        }
        if (previous) {
          previous.references.push(reference); previous.lineage.push(reference); coverage.deduplicatedLineCount++;
        } else active.set(key, { key, kind, value, quote: line.quote, reference, references: [reference], lineage: [reference] });
      }
    }
  }
  if (!active.size) return null; // The caller may choose an explicitly lossy fallback.
  if (active.size > maxItems) error('STRUCTURED_CONTEXT_LIMIT', `Structured context has ${active.size} active declarations; its limit is ${maxItems}. Split the task or reduce declarations; none were truncated.`);
  for (const item of active.values()) {
    if (countPoints(item.quote) > maxItemCodepoints) error('STRUCTURED_CONTEXT_LIMIT', `Structured declaration ${item.key} exceeds ${maxItemCodepoints} codepoints. Shorten it explicitly; it was not truncated.`);
  }
  const text = notice + '\n\n' + [...active.values()].map(item => `[${item.reference.turnId}:${item.reference.offsets.start}-${item.reference.offsets.end}] ${item.quote}`).join('\n');
  const totalTextCodepoints = countPoints(text);
  if (totalTextCodepoints > maxTotalCodepoints) error('STRUCTURED_CONTEXT_LIMIT', `Structured context needs ${totalTextCodepoints} codepoints including notices and citations; its limit is ${maxTotalCodepoints}. Split the task or reduce declarations; none were truncated.`);
  const digest = async text => {
    const hash = await hashText(text);
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) invalid('hashText must return a lowercase SHA-256 digest.');
    return hash;
  };
  const sources = await Promise.all(turns.map(async turn => ({ turnId: turn.id, contentHash: await digest(turn.content) })));
  const hashes = new Map(sources.map(source => [source.turnId, source.contentHash]));
  const referenceHashes = new Map();
  async function bound(reference) {
    if (!referenceHashes.has(reference.quote)) referenceHashes.set(reference.quote, digest(reference.quote));
    return { turnId: reference.turnId, turnHash: hashes.get(reference.turnId), offsets: { ...reference.offsets },
      lineHash: await referenceHashes.get(reference.quote), marker: reference.marker };
  }
  const items = await Promise.all([...active.values()].map(async item => ({ key: item.key, kind: item.kind,
    value: item.value, quote: item.quote, turnId: item.reference.turnId, turnHash: hashes.get(item.reference.turnId),
    offsets: { ...item.reference.offsets }, sourceRefs: await Promise.all(item.references.map(bound)),
    lineage: await Promise.all(item.lineage.map(bound)) })));
  return freeze({ strategy, text, items, excerpts: items.map(item => ({ turnId: item.turnId, text: item.quote, truncated: false })),
    sources, contentHash: await digest(text), coverage: { ...coverage, omittedUnmarkedTurnCount: omittedUnmarkedTurns.size,
      retainedItemCount: items.length, retainedReferenceCount: items.reduce((total, item) => total + item.sourceRefs.length, 0),
      retainedCodepoints: items.reduce((total, item) => total + countPoints(item.quote), 0), totalTextCodepoints,
      allActiveDeclaredItemsRetained: true, completeConversation: false } });
}
