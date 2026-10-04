import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
export const DIMS = 768;

// 500-word windows, 50-word overlap so ideas spanning a boundary survive in one chunk.
export function chunk(text, size = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    out.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return out;
}

// ponytail: single retry on 429, add a queue if free-tier limits bite in real use
async function retry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.status !== 429) throw e;
    await new Promise(r => setTimeout(r, 2000));
    return fn();
  }
}

export async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await retry(() => ai.models.embedContent({
      model: EMBED_MODEL,
      contents: texts.slice(i, i + 100),
      config: { outputDimensionality: DIMS },
    }));
    out.push(...res.embeddings.map(e => e.values));
  }
  return out;
}

export async function generate(prompt, schema) {
  const res = await retry(() => ai.models.generateContent({
    model: CHAT_MODEL,
    contents: prompt,
    config: schema ? { responseMimeType: 'application/json', responseSchema: schema } : undefined,
  }));
  return { text: res.text, tokens: res.usageMetadata?.totalTokenCount ?? 0 };
}

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

// Grades against the stored quiz; anything the client sends that isn't a valid index counts as wrong.
export function grade(questions, answers) {
  const results = questions.map((q, i) => ({
    correct: answers?.[i] === q.answer,
    answer: q.answer,
    explanation: q.explanation,
  }));
  return { results, score: results.filter(r => r.correct).length };
}

// Deducts actual token usage, clamped at 0 in one atomic update. Embedding calls aren't charged
// (the API returns no usage for them). ponytail: add a flat indexing fee if uploads get abused.
export function charge(users, userId, tokens) {
  return users.findOneAndUpdate(
    { _id: userId },
    [{ $set: { credits: { $max: [0, { $subtract: ['$credits', tokens] }] } } }],
    { returnDocument: 'after', projection: { credits: 1 } },
  ).then(u => u?.credits ?? 0);
}
