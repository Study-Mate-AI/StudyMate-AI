// Self-check for the pure logic: `node check.js` (no DB or API key needed).
process.env.GEMINI_API_KEY ??= 'unused';
const assert = (await import('node:assert/strict')).default;
const { chunk, grade } = await import('./ai.js');

const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
assert.deepEqual(chunk(''), []);
assert.equal(chunk(words(10)).length, 1);
assert.equal(chunk(words(500)).length, 1);
const c = chunk(words(1000));
assert.equal(c.length, 3);                          // windows start at 0, 450, 900
assert.equal(c[1].split(' ')[0], 'w450');           // 50-word overlap
assert.equal(c.at(-1).split(' ').at(-1), 'w999');   // nothing dropped at the end

const qs = [{ answer: 1, explanation: 'a' }, { answer: 3, explanation: 'b' }];
assert.equal(grade(qs, [1, 3]).score, 2);
assert.equal(grade(qs, [1, 0]).score, 1);
assert.equal(grade(qs, ['1', 3]).score, 1);         // strings don't sneak through
assert.equal(grade(qs, null).score, 0);
assert.equal(grade(qs, [1, 3, 9, 9]).score, 2);     // extra answers ignored

console.log('ok');
