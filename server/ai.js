import { GoogleGenAI, Type } from '@google/genai';

// Key pool: GEMINI_API_KEY may hold several comma-separated keys. Use keys from different Google projects:
// keys inside one project share the same quota, so pooling them gains nothing.
const pool = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean).map(apiKey => new GoogleGenAI({ apiKey }));
if (!pool.length) pool.push(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
let next = 0;

// LiteLLM proxy (litellm/docker-compose.yml): when LITELLM_URL is set, Gemini is called through it over
// its OpenAI-style API, and LiteLLM does the key pooling. Unset it to call Gemini directly.
const { LITELLM_URL, LITELLM_KEY } = process.env;
async function proxy(path, body) {
  const res = await fetch(LITELLM_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LITELLM_KEY}` }, body: JSON.stringify(body),
  }).catch(e => { throw Object.assign(new Error('LiteLLM proxy not reachable at ' + LITELLM_URL + '. Is Docker running?'), { cause: e }); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `LiteLLM ${res.status}`), { status: res.status });
  return data;
}
// Gemini's schema uses upper-case types (ARRAY, OBJECT); standard JSON Schema wants lower-case.
const jsonSchema = schema => JSON.parse(JSON.stringify(schema).replace(/"type":"([A-Z]+)"/g, (_, t) => `"type":"${t.toLowerCase()}"`));
// Chat models in order. Each model has its own daily free-tier quota (gemini-3.5-flash: only 20 requests/day),
// so when one runs out (429) the next takes over. Flash-Lite first: higher free limits and cheaper.
const CHAT_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-3.5-flash').split(',').map(m => m.trim()).filter(Boolean);
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
export const DIMS = 768;

// 500-word windows, 50-word overlap so ideas spanning a boundary survive in one chunk.
// Takes a string, or one string per PDF page; each chunk records the pages it spans for citations.
export function chunk(input, size = 500, overlap = 50) {
  const words = [].concat(input).flatMap((t, p) => t.split(/\s+/).filter(Boolean).map(w => [w, p + 1]));
  const out = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const win = words.slice(i, i + size);
    out.push({ text: win.map(w => w[0]).join(' '), from: win[0][1], to: win.at(-1)[1] });
    if (i + size >= words.length) break;
  }
  return out;
}

// Which sources an answer cites: handles [Source 2], [Source 1, 3] and [Sources 1, 2].
export const cited = text => new Set([...String(text).matchAll(/\[Sources? [^\]]*\]/g)].flatMap(m => (m[0].match(/\d+/g) ?? []).map(Number)));

// Round-robin over the pool. A key that's rate-limited (429), overloaded (503) or rejected (403) hands the
// request to the next key; if every key fails that way, wait 2 s and try once more.
// ponytail: no per-key cooldown, a busy key is just skipped this time; track cooldowns if the pool grows large
export async function retry(fn) {
  for (let i = 0; i < pool.length; i++) {
    try { return await fn(pool[next++ % pool.length]); }
    catch (e) { if (![429, 503, 403].includes(e.status)) throw e; }
  }
  await new Promise(r => setTimeout(r, 2000));
  return fn(pool[next++ % pool.length]);
}

// taskType: notes are embedded as documents, questions as queries, which Gemini tunes for search.
export async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    if (LITELLM_URL) {
      const d = await retry(() => proxy('/v1/embeddings', { model: 'embed', input: texts.slice(i, i + 100), dimensions: DIMS, task_type: taskType }));
      out.push(...d.data.sort((a, b) => a.index - b.index).map(e => e.embedding));
      continue;
    }
    const res = await retry(ai => ai.models.embedContent({
      model: EMBED_MODEL,
      contents: texts.slice(i, i + 100),
      config: { outputDimensionality: DIMS, taskType },
    }));
    out.push(...res.embeddings.map(e => e.values));
  }
  return out;
}

// Wallet charge: the answer at full rate, the prompt (mostly notes) at 1/4. Gemini prices input far below output,
// and the notes are ~90% of every request, so charging them 1:1 made one answer cost ~2,000 tokens.
export const cost = (prompt = 0, total = 0) => total - prompt + Math.ceil(prompt / 4);

// file: optional { data: Buffer, mimeType } (an image or PDF) sent along with the prompt.
export async function generate(prompt, schema, file) {
  if (LITELLM_URL) {
    const d = await retry(() => proxy('/v1/chat/completions', {
      model: 'chat', // thinking settings live per model in litellm/config.yaml
      messages: [{ role: 'user', content: !file ? prompt : [{ type: 'text', text: prompt }, file.mimeType === 'application/pdf'
        ? { type: 'file', file: { file_data: `data:application/pdf;base64,${file.data.toString('base64')}` } }
        : { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data.toString('base64')}` } }] }],
      ...(schema && { response_format: { type: 'json_schema', json_schema: { name: 'result', schema: jsonSchema(schema) } } }),
    }));
    return { text: d.choices[0].message.content, tokens: cost(d.usage?.prompt_tokens, d.usage?.total_tokens) };
  }
  for (const [i, model] of CHAT_MODELS.entries()) {
    try {
      const res = await retry(ai => ai.models.generateContent({
        model,
        contents: !file ? prompt : [{ role: 'user', parts: [{ inlineData: { mimeType: file.mimeType, data: file.data.toString('base64') } }, { text: prompt }] }],
        // Thinking off on Flash: measured ~15% of a tutor answer's tokens and ~40% of a quiz's. Flash-Lite doesn't think
        // by default and rejects thinkingBudget, so it gets no thinkingConfig.
        config: { ...(!model.includes('lite') && { thinkingConfig: { thinkingBudget: 0 } }), ...(schema && { responseMimeType: 'application/json', responseSchema: schema }) },
      }));
      return { text: res.text, tokens: cost(res.usageMetadata?.promptTokenCount, res.usageMetadata?.totalTokenCount) };
    } catch (e) { if (e.status !== 429 || i === CHAT_MODELS.length - 1) throw e; } // daily quota used up: next model
  }
}

// Text out of an image or a scanned PDF (no text layer), read by Gemini. Returns one string per page.
export async function readFile(data, mimeType) {
  const { text, tokens } = await generate(`Transcribe all the text in this file exactly, in reading order. Start every page with a line "=== PAGE n ===".
Describe any diagram or chart in one short line in [square brackets]. Output only the transcription as plain text, no Markdown.`, null, { data, mimeType });
  return { pages: pagesOf(text), tokens };
}
export const pagesOf = text => text.split(/^=== PAGE \d+ ===[ \t]*$/m).map(p => p.trim()).filter((p, i) => i > 0 || p);

export const quizSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      q: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      answer: { type: Type.INTEGER },
      explanation: { type: Type.STRING },
    },
    required: ['q', 'options', 'answer', 'explanation'],
  },
};

// Drops malformed questions, then shuffles options: LLMs put the right answer in slot A/B far too often.
export function clean(raw, rand = Math.random) {
  const s = v => typeof v === 'string' && v.trim();
  return (Array.isArray(raw) ? raw : []).filter(q => s(q?.q) && s(q.explanation) && Array.isArray(q.options) && q.options.length === 4
    && q.options.every(s) && new Set(q.options.map(o => o.trim().toLowerCase())).size === 4
    && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4)
    .map(q => {
      const order = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      return { q: q.q.trim(), options: order.map(i => q.options[i].trim()), answer: order.indexOf(q.answer), explanation: q.explanation.trim() };
    });
}

// Report card from attempts sorted oldest first: [{ subject, topic, difficulty, score, total, at, ... }].
// A topic is weak when its last 3 attempts average under 70%, so improving clears the flag.
export function analyze(rows) {
  const mean = a => a.reduce((t, x) => t + x, 0) / a.length;
  const sum = (a, k) => a.reduce((t, r) => t + r[k], 0);
  const acc = a => ({ attempts: a.length, accuracy: sum(a, 'total') ? sum(a, 'score') / sum(a, 'total') : 0 });
  const rated = rows.map(r => ({ ...r, pct: r.total ? r.score / r.total : 0 }));
  const groups = Object.values(Object.groupBy(rated, r => r.subject + '\u0000' + r.topic));
  const topics = groups.map(a => {
    const pcts = a.map(r => r.pct), recent = mean(pcts.slice(-3));
    return { subject: a[0].subject, topic: a[0].topic, attempts: a.length, avg: mean(pcts), recent,
      last: pcts.at(-1), change: pcts.length > 1 ? pcts.at(-1) - pcts[0] : 0, lastAt: a.at(-1).at, weak: recent < 0.7 };
  }).sort((a, b) => a.recent - b.recent);
  return {
    totals: { ...acc(rated), questions: sum(rated, 'total'), correct: sum(rated, 'score') },
    byDifficulty: Object.fromEntries(['Easy', 'Medium', 'Hard'].map(d => [d, acc(rated.filter(r => r.difficulty === d))])),
    topics,
    trend: rated.slice(-30),
  };
}

// Grades against the stored quiz; anything the client sends that isn't a valid index counts as wrong.
export function grade(questions, answers) {
  const results = questions.map((q, i) => ({
    correct: answers?.[i] === q.answer,
    answer: q.answer,
    explanation: q.explanation,
  }));
  return { results, score: results.filter(r => r.correct).length };
}

// Deducts actual token usage, clamped at 0 in one atomic update, and logs it to the wallet ledger.
// Embedding calls aren't charged (the API returns no usage for them).
// ponytail: add a flat indexing fee if uploads get abused.
export async function charge(db, userId, tokens, kind) {
  const before = await db.collection('users').findOneAndUpdate(
    { _id: userId },
    [{ $set: { credits: { $max: [0, { $subtract: ['$credits', tokens] }] } } }],
    { returnDocument: 'before', projection: { credits: 1 } },
  );
  const spent = Math.min(before?.credits ?? 0, tokens);
  if (spent) await db.collection('ledger').insertOne({ userId, kind, delta: -spent, at: new Date() });
  return (before?.credits ?? 0) - spent;
}
