// Authored, disposable acceptance dialogue. Facts are inputs, never model mocks.
export const smokeTurns = Object.freeze([
  { id: 'greeting', text: 'Hello. Please keep your replies to one short sentence.' },
  { id: 'name', text: 'Your name in this conversation is Fred. Please acknowledge briefly.' },
  { id: 'name-recall', text: 'What is your name here?', required: [['Fred']], meaning: 'Retains the conversational name.' },
  { id: 'mars', text: 'Let us talk about space. Mars has two moons: Phobos and Deimos. Our Mars watch is on Monday. Our observing notebook code for the Mars watch is Cedar-17. Please acknowledge in one short sentence.' },
  { id: 'moons-followup', text: 'What are their names?', required: [['Phobos'], ['Deimos']], meaning: 'Resolves a short factual follow-up.' },
  { id: 'correction', text: 'A correction to our plan: the Mars watch is on Tuesday, replacing Monday. Please acknowledge briefly.' },
  { id: 'correction-recall', text: 'On which day is our Mars watch now? Answer with just the day.', required: [['Tuesday']], forbidden: ['Monday'], meaning: 'Uses the explicit corrected observing day.' },
]);

export const spaceFacts = Object.freeze([
  'Earth orbits the Sun, and the Moon orbits Earth. Mars has two moons named Phobos and Deimos.',
  'Mercury is the closest planet to the Sun. Venus has a thick atmosphere and is hotter at its surface than Mercury.',
  'Jupiter is the largest planet in our Solar System. Its Great Red Spot is a long-lived storm.',
  'Saturn has a large ring system made mostly of ice particles. Its moon Titan has a thick atmosphere.',
  'Uranus rotates on a strongly tilted axis. Neptune is the most distant of the eight planets from the Sun.',
  'A light-year measures distance, not time. Sunlight takes about eight minutes to reach Earth.',
  'The Moon keeps roughly the same face toward Earth. Its surface gravity is roughly one sixth of Earth gravity.',
  'Stars generate energy by nuclear fusion. Our Sun is a star, and the Solar System belongs to the Milky Way galaxy.',
]);

export const recallTurn = Object.freeze({ id: 'retained-recall', text: 'Using our earlier notes, name the two Mars moons, our observing notebook code, and the current day of our Mars watch. Answer briefly.',
  required: [['Phobos'], ['Deimos'], ['Cedar-17'], ['Tuesday']], forbidden: ['Monday'], meaning: 'Retains a unique authored notebook code and the corrected plan after compaction; public starter facts alone cannot pass.' });

export function spaceNote(index, { large = false } = {}) {
  const selected = large ? [spaceFacts[index % spaceFacts.length], spaceFacts[(index + 1) % spaceFacts.length], spaceFacts[(index + 2) % spaceFacts.length]]
    : [spaceFacts[index % spaceFacts.length]];
  return { id: 'space-note-' + (index + 1), text: 'Here is another note for our space discussion. ' + selected.join(' ')
    + ' Please keep our earlier observing notebook code and corrected Mars watch day in mind. Acknowledge in at most eight words.' };
}

export function semanticChecks(turn, reply) {
  const failures = [];
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const alternatives of turn.required || []) {
    if (!alternatives.some(value => new RegExp('\\b' + escaped(value) + '\\b', 'iu').test(reply))) failures.push('Missing required fact: ' + alternatives.join(' or '));
    else for (const value of alternatives) if (new RegExp('\\b(?:not|never|isn.t|wasn.t|aren.t)\\s+(?:(?:called|named|on|the|a|an|really|actually)\\s+)?' + escaped(value) + '\\b', 'iu').test(reply)) failures.push('Explicitly negates required fact: ' + value);
  }
  for (const value of turn.forbidden || []) for (const match of reply.matchAll(new RegExp('\\b' + escaped(value) + '\\b', 'giu'))) {
    const prefix = reply.slice(Math.max(0, match.index - 30), match.index);
    if (!/\b(?:not|replacing|instead of|rather than)\s*$/iu.test(prefix)) failures.push('Affirms superseded/forgotten fact: ' + value);
  }
  if (/No older user passage selected\.|No saved evidence matched this query\.|No evidence or context provided\./iu.test(reply)) failures.push('Repeats an application diagnostic notice.');
  return failures;
}
