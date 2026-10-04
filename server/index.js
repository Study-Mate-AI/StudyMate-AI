import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import pdf from 'pdf-parse/lib/pdf-parse.js'; // lib path: the package root runs a debug test under ESM
import { chunk, embed, generate, grade, charge, quizSchema, DIMS } from './ai.js';
import billing from './billing.js';

const { MONGODB_URI, JWT_SECRET, PORT = 3000 } = process.env;
if (!MONGODB_URI || !JWT_SECRET) throw new Error('Set MONGODB_URI and JWT_SECRET in server/.env');

const db = (await new MongoClient(MONGODB_URI).connect()).db('studymate');
const users = db.collection('users');
const chunks = db.collection('chunks');
const convos = db.collection('conversations');
const quizzes = db.collection('quizzes');

await users.createIndex({ email: 1 }, { unique: true });
await convos.createIndex({ userId: 1, subject: 1 }, { unique: true });
await chunks.createSearchIndex({
  name: 'vec', type: 'vectorSearch',
  definition: { fields: [
    { type: 'vector', path: 'embedding', numDimensions: DIMS, similarity: 'cosine' },
    { type: 'filter', path: 'userId' },
    { type: 'filter', path: 'subject' },
  ] },
}).catch(e => { if (!/already exists|IndexAlreadyExists|duplicate/i.test(e.message)) throw e; });

const app = express();
app.use(billing(db)); // before express.json: the webhook needs the raw body
app.use(express.json(), cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const str = (v, max = 200) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- auth ----------
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 };
const login = (res, u) => res.cookie('token', jwt.sign({ id: u._id }, JWT_SECRET, { expiresIn: '7d' }), cookieOpts)
  .json({ id: u._id, email: u.email, credits: u.credits, plan: u.plan });

function auth(req, res, next) {
  try { req.uid = new ObjectId(jwt.verify(req.cookies.token, JWT_SECRET).id); next(); }
  catch { bad(res, 'Not logged in', 401); }
}
async function hasCredits(req, res, next) {
  const u = await users.findOne({ _id: req.uid }, { projection: { credits: 1 } });
  u?.credits > 0 ? next() : bad(res, 'Out of tokens — recharge to continue', 402);
}

app.post('/api/signup', async (req, res) => {
  const email = str(req.body.email)?.toLowerCase(), { password } = req.body;
  if (!email?.includes('@') || typeof password !== 'string' || password.length < 8)
    return bad(res, 'Valid email and 8+ char password required');
  const u = { email, passwordHash: await bcrypt.hash(password, 12), credits: 10000, plan: 'free' };
  try { u._id = (await users.insertOne(u)).insertedId; }
  catch (e) { if (e.code === 11000) return bad(res, 'Email already registered', 409); throw e; }
  login(res, u);
});

app.post('/api/login', async (req, res) => {
  const u = await users.findOne({ email: str(req.body.email)?.toLowerCase() });
  if (!u || typeof req.body.password !== 'string' || !(await bcrypt.compare(req.body.password, u.passwordHash)))
    return bad(res, 'Wrong email or password', 401);
  login(res, u);
});

app.post('/api/logout', (req, res) => res.clearCookie('token').json({ ok: true }));

app.get('/api/me', auth, async (req, res) => {
  const u = await users.findOne({ _id: req.uid }, { projection: { email: 1, credits: 1, plan: 1 } });
  u ? res.json({ id: u._id, email: u.email, credits: u.credits, plan: u.plan }) : bad(res, 'Not logged in', 401);
});

// ---------- notes ----------
app.get('/api/notes', auth, async (req, res) => {
  res.json(await chunks.aggregate([
    { $match: { userId: req.uid } },
    { $group: { _id: '$noteId', title: { $first: '$noteTitle' }, subject: { $first: '$subject' }, chunks: { $sum: 1 }, at: { $first: '$at' } } },
    { $sort: { at: -1 } },
  ]).toArray());
});

app.post('/api/notes', auth, upload.single('file'), async (req, res) => {
  const title = str(req.body.title), subject = str(req.body.subject, 80);
  if (!title || !subject) return bad(res, 'Title and subject required');
  let text = typeof req.body.text === 'string' ? req.body.text : '';
  if (req.file) {
    if (req.file.mimetype !== 'application/pdf') return bad(res, 'Only PDF files');
    text = (await pdf(req.file.buffer)).text;
  }
  const parts = chunk(text);
  if (!parts.length) return bad(res, 'No readable text (scanned PDFs need OCR)');
  const vectors = await embed(parts);
  const noteId = new ObjectId(), at = new Date();
  await chunks.insertMany(parts.map((t, i) => ({
    userId: req.uid, noteId, noteTitle: title, subject, text: t, embedding: vectors[i], i, at,
  })));
  res.json({ _id: noteId, title, subject, chunks: parts.length });
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const r = await chunks.deleteMany({ noteId: new ObjectId(req.params.id), userId: req.uid });
  res.json({ deleted: r.deletedCount });
});

async function retrieve(uid, subject, query, limit = 5) {
  const [v] = await embed([query]);
  return chunks.aggregate([
    { $vectorSearch: { index: 'vec', path: 'embedding', queryVector: v, numCandidates: 100, limit, filter: { userId: uid, subject } } },
    { $project: { _id: 0, noteTitle: 1, text: 1 } },
  ]).toArray();
}

// ---------- chat ----------
app.get('/api/chat/:subject', auth, async (req, res) => {
  const c = await convos.findOne({ userId: req.uid, subject: req.params.subject });
  res.json(c?.messages ?? []);
});

app.post('/api/chat', auth, hasCredits, async (req, res) => {
  const subject = str(req.body.subject, 80), question = str(req.body.question, 2000);
  if (!subject || !question) return bad(res, 'Subject and question required');
  const sources = await retrieve(req.uid, subject, question);
  const context = sources.map((s, i) => `[Source ${i + 1}] (${s.noteTitle})\n${s.text}`).join('\n\n');
  const { text, tokens } = await generate(
    `You are a study tutor. Answer ONLY using the student's notes below. Cite the sources you use like [Source 1].
If the notes do not contain the answer, reply exactly: "I don't have that in your notes." Never use outside knowledge.

NOTES:
${context || '(no notes for this subject)'}

QUESTION: ${question}`);
  const at = new Date();
  await convos.updateOne({ userId: req.uid, subject }, { $push: { messages: { $each: [
    { role: 'user', content: question, at },
    { role: 'assistant', content: text, sources, at },
  ] } } }, { upsert: true });
  res.json({ answer: text, sources, credits: await charge(users, req.uid, tokens) });
});

// ---------- quizzes ----------
const hideAnswers = q => ({ ...q, questions: q.questions.map(({ q: text, options }) => ({ q: text, options })) });

app.post('/api/quiz', auth, hasCredits, async (req, res) => {
  const subject = str(req.body.subject, 80), topic = str(req.body.topic, 120);
  const difficulty = ['Easy', 'Medium', 'Hard'].includes(req.body.difficulty) ? req.body.difficulty : 'Medium';
  const n = Math.min(Math.max(Number(req.body.n) || 5, 1), 15);
  if (!subject || !topic) return bad(res, 'Subject and topic required');
  const sources = await retrieve(req.uid, subject, topic, 8);
  if (!sources.length) return bad(res, 'No notes found for this subject yet');
  const level = { Easy: 'direct recall of a single fact', Medium: 'understanding and applying one concept', Hard: 'connecting two or more concepts' }[difficulty];
  const { text, tokens } = await generate(
    `Write ${n} multiple-choice questions on "${topic}" using ONLY these notes. Difficulty: ${difficulty} (${level}).
Each has exactly 4 options; "answer" is the 0-based index of the correct option; "explanation" says why, citing the notes.

NOTES:
${sources.map(s => s.text).join('\n\n')}`, quizSchema);
  const questions = JSON.parse(text).filter(q => q.options?.length === 4 && q.answer >= 0 && q.answer < 4);
  const credits = await charge(users, req.uid, tokens);
  if (!questions.length) return bad(res, 'Quiz generation failed, try again', 502);
  const quiz = { userId: req.uid, subject, topic, difficulty, questions, attempts: [], at: new Date() };
  quiz._id = (await quizzes.insertOne(quiz)).insertedId;
  res.json({ ...hideAnswers(quiz), credits });
});

app.get('/api/quiz/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const q = await quizzes.findOne({ _id: new ObjectId(req.params.id), userId: req.uid }, { projection: { attempts: 0 } });
  q ? res.json(hideAnswers(q)) : bad(res, 'Not found', 404);
});

app.post('/api/quiz/:id/attempt', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id) || !Array.isArray(req.body.answers)) return bad(res, 'Bad request');
  const _id = new ObjectId(req.params.id);
  const q = await quizzes.findOne({ _id, userId: req.uid });
  if (!q) return bad(res, 'Not found', 404);
  const { results, score } = grade(q.questions, req.body.answers);
  await quizzes.updateOne({ _id }, { $push: { attempts: { answers: req.body.answers.slice(0, q.questions.length), score, at: new Date() } } });
  res.json({ score, total: q.questions.length, results });
});

// ---------- analytics ----------
app.get('/api/stats', auth, async (req, res) => {
  const base = [
    { $match: { userId: req.uid } },
    { $unwind: '$attempts' },
    { $project: { subject: 1, topic: 1, at: '$attempts.at', pct: { $divide: ['$attempts.score', { $size: '$questions' }] } } },
  ];
  const [topics, trend] = await Promise.all([
    quizzes.aggregate([...base,
      { $group: { _id: { subject: '$subject', topic: '$topic' }, avg: { $avg: '$pct' }, attempts: { $sum: 1 } } },
      { $sort: { avg: 1 } }]).toArray(),
    quizzes.aggregate([...base, { $sort: { at: 1 } }, { $project: { _id: 0, at: 1, pct: 1, topic: 1 } }]).toArray(),
  ]);
  res.json({ topics: topics.map(t => ({ ...t._id, avg: t.avg, attempts: t.attempts, weak: t.avg < 0.7 })), trend });
});

// Production: serve the built client from the same origin.
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html'))); // SPA routes on refresh
app.use((err, req, res, next) => { console.error(err); bad(res, 'Server error', 500); });
app.listen(PORT, () => console.log(`StudyMate API on :${PORT}`));
