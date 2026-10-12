// Self-check for the pure logic: `node check.js` (no DB or API key needed).
process.env.GEMINI_API_KEY = 'k1, k2,k3'; // fake pool, never sent anywhere
const assert = (await import('node:assert/strict')).default;
const { chunk, cited, grade, clean, analyze, retry, cost } = await import('./ai.js');

const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
assert.deepEqual(chunk(''), []);
assert.equal(chunk(words(10)).length, 1);
assert.equal(chunk(words(500)).length, 1);
const c = chunk(words(1000));
assert.equal(c.length, 3);                          // windows start at 0, 450, 900
assert.equal(c[1].text.split(' ')[0], 'w450');           // 50-word overlap
assert.equal(c.at(-1).text.split(' ').at(-1), 'w999');   // nothing dropped at the end

// pages: each chunk knows which PDF pages it spans; empty pages keep the numbering
const pg = chunk([words(300), '', words(300)]);
assert.deepEqual(pg.map(p => [p.from, p.to]), [[1, 3], [3, 3]]);
assert.deepEqual(chunk(words(10))[0], { text: words(10), from: 1, to: 1 });

// cited: the source numbers an answer actually uses
assert.deepEqual([...cited('A [Source 2]. B [Source 1, 3] and [Sources 4, 5]. [Source] [x 9]')].sort(), [1, 2, 3, 4, 5]);
assert.equal(cited("I don't have that in your notes.").size, 0);

const qs = [{ answer: 1, explanation: 'a' }, { answer: 3, explanation: 'b' }];
assert.equal(grade(qs, [1, 3]).score, 2);
assert.equal(grade(qs, [1, 0]).score, 1);
assert.equal(grade(qs, ['1', 3]).score, 1);         // strings don't sneak through
assert.equal(grade(qs, null).score, 0);
assert.equal(grade(qs, [1, 3, 9, 9]).score, 2);     // extra answers ignored

// clean: malformed questions dropped, shuffled answer still points at the right option text
const good = { q: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 2, explanation: 'x' };
assert.equal(clean([good, { ...good, options: ['a', 'a', 'b', 'c'] }, { ...good, answer: 4 }, { ...good, answer: '1' }, { ...good, q: ' ' }, null]).length, 1);
assert.deepEqual(clean('nope'), []);
for (let k = 0; k < 50; k++) { const [c] = clean([good]); assert.equal(c.options[c.answer], 'c'); assert.equal(new Set(c.options).size, 4); }
assert.ok(new Set(Array.from({ length: 200 }, () => clean([good])[0].answer)).size > 1); // actually shuffles

// analyze: weak = last 3 attempts average under 70%
const at = i => new Date(2026, 0, i);
const rows = [
  { subject: 'Bio', topic: 'Cells', difficulty: 'Easy', score: 1, total: 5, at: at(1) },
  { subject: 'Bio', topic: 'Cells', difficulty: 'Easy', score: 5, total: 5, at: at(2) },
  { subject: 'Bio', topic: 'Cells', difficulty: 'Hard', score: 5, total: 5, at: at(3) },
  { subject: 'Bio', topic: 'Cells', difficulty: 'Hard', score: 4, total: 5, at: at(4) },
  { subject: 'Chem', topic: 'Acids', difficulty: 'Medium', score: 3, total: 10, at: at(5) },
];
const r = analyze(rows);
assert.deepEqual(r.totals, { attempts: 5, accuracy: 18 / 30, questions: 30, correct: 18 });
assert.equal(r.topics[0].topic, 'Acids');                // weakest first
assert.equal(r.topics[0].weak, true);
const cells = r.topics[1];
assert.equal(cells.weak, false);                         // early 20% no longer counts
assert.equal(cells.attempts, 4);
assert.ok(Math.abs(cells.change - 0.6) < 1e-9);          // 20% -> 80%
assert.equal(r.byDifficulty.Hard.accuracy, 0.9);
assert.equal(r.byDifficulty.Medium.attempts, 1);
assert.deepEqual(analyze([]).totals, { attempts: 0, accuracy: 0, questions: 0, correct: 0 });

// key pool: round-robin, failover on 429/503/403, real errors not retried
const key = ai => ai.models.apiClient.getApiKey();
const seen = [];
for (let i = 0; i < 4; i++) seen.push(await retry(async ai => key(ai)));
assert.deepEqual(seen, ['k1', 'k2', 'k3', 'k1']);
assert.equal(await retry(async ai => { if (key(ai) === 'k2') throw Object.assign(new Error('busy'), { status: 429 }); return key(ai); }), 'k3');
let calls = 0;
await assert.rejects(retry(async () => { calls++; throw Object.assign(new Error('bad request'), { status: 400 }); }));
assert.equal(calls, 1);

// wallet cost: prompt at 1/4, answer at full rate
assert.equal(cost(2000, 2200), 700);
assert.equal(cost(3, 10), 8);
assert.equal(cost(undefined, undefined), 0);

// docx / pptx: build tiny Office files in memory (zip of XML) and read them back
const { deflateRawSync, crc32 } = await import('node:zlib');
const { docxText, pptxSlides } = await import('./extract.js');
const zip = files => {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc32(raw), 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(raw), 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
};
const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Cells &amp; tissues</w:t></w:r><w:r><w:t xml:space="preserve"> are alive</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t>ATP &#x2192; energy</w:t></w:r></w:p></w:body></w:document>' });
assert.equal(docxText(docx), 'Cells & tissues are alive\nATP → energy');
const pptx = zip({ 'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p><a:p><a:r><a:t>lines</a:t></a:r></a:p></p:sld>', 'ppt/slides/_rels/slide2.xml.rels': '<x/>' });
assert.deepEqual(pptxSlides(pptx), ['Two\nlines', 'Ten']);            // numeric order, not "10" < "2"
assert.throws(() => docxText(Buffer.from('not a zip')));
assert.throws(() => docxText(pptx));                                   // a .pptx renamed to .docx

// pagesOf: Gemini's "=== PAGE n ===" transcription back into pages
const { pagesOf } = await import('./ai.js');
assert.deepEqual(pagesOf('=== PAGE 1 ===\nIntro\n=== PAGE 2 ===\n\n=== PAGE 3 ===\nEnd'), ['Intro', '', 'End']);
assert.deepEqual(pagesOf('Just one image of text'), ['Just one image of text']);

console.log('ok');

// razorpay signature: only the HMAC of order|payment with the secret passes
const { rzpValid } = await import("./billing.js");
const { createHmac } = await import("node:crypto");
const goodSig = createHmac("sha256", "s3").update("order_1|pay_1").digest("hex");
assert.ok(rzpValid("order_1", "pay_1", goodSig, "s3"));
assert.ok(!rzpValid("order_1", "pay_2", goodSig, "s3"));
assert.ok(!rzpValid("order_1", "pay_1", goodSig, "other"));
assert.ok(!rzpValid("order_1", "pay_1", undefined, "s3"));
console.log("razorpay ok");
