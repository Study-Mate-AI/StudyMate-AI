import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { MongoClient, ObjectId } from 'mongodb';
import pdf from 'pdf-parse/lib/pdf-parse.js'; // lib path: the package root runs a debug test under ESM
import { chunk, embed, generate, grade, charge, quizSchema, DIMS } from './ai.js';
import billing, { PACK, PRO } from './billing.js';

const { MONGODB_URI, JWT_SECRET, PORT = 3000, SMTP_URL, MAIL_FROM = 'StudyMate <no-reply@studymate.local>', APP_URL = 'http://localhost:5173' } = process.env;
if (!MONGODB_URI || !JWT_SECRET) throw new Error('Set MONGODB_URI and JWT_SECRET in server/.env');

const db = (await new MongoClient(MONGODB_URI).connect()).db('studymate');
const users = db.collection('users');
const chunks = db.collection('chunks');
const convos = db.collection('conversations');
const quizzes = db.collection('quizzes');
const ledger = db.collection('ledger');

await users.createIndex({ email: 1 }, { unique: true });
await ledger.createIndex({ userId: 1, at: -1 });
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
// sv = session version: a password reset bumps it, which logs out every older cookie.
const login = (res, u) => res.cookie('token', jwt.sign({ id: u._id, sv: u.sv ?? 0 }, JWT_SECRET, { expiresIn: '7d' }), cookieOpts)
  .json({ id: u._id, email: u.email, credits: u.credits, plan: u.plan });

async function auth(req, res, next) {
  let t;
  try { t = jwt.verify(req.cookies.token, JWT_SECRET); req.uid = new ObjectId(t.id); }
  catch { return bad(res, 'Not logged in', 401); }
  const u = await users.findOne({ _id: req.uid }, { projection: { sv: 1 } });
  u && (u.sv ?? 0) === (t.sv ?? 0) ? next() : bad(res, 'Not logged in', 401);
}
// bcrypt ignores bytes past 72, so cap it rather than silently truncate
const validPw = p => typeof p === 'string' && p.length >= 8 && Buffer.byteLength(p) <= 72;
const sha = t => createHash('sha256').update(t).digest('hex');
const mailer = SMTP_URL && nodemailer.createTransport(SMTP_URL);
async function hasCredits(req, res, next) {
  const u = await users.findOne({ _id: req.uid }, { projection: { credits: 1 } });
  u?.credits > 0 ? next() : bad(res, 'Out of tokens — recharge to continue', 402);
}

// ponytail: in-memory per-IP limit, fine for one process; move to a Mongo TTL collection if you scale out
const attempts = new Map();
function throttle(req, res, next) {
  const now = Date.now(), a = attempts.get(req.ip);
  if (!a || a.reset < now) attempts.set(req.ip, { n: 1, reset: now + 15 * 6e4 });
  else if (++a.n > 10) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);
  next();
}

app.post('/api/signup', throttle, async (req, res) => {
  const email = str(req.body.email)?.toLowerCase(), { password } = req.body;
  if (!email?.includes('@') || !validPw(password))
    return bad(res, 'Valid email and an 8–72 character password required');
  const u = { email, passwordHash: await bcrypt.hash(password, 12), credits: 10000, plan: 'free' };
  try { u._id = (await users.insertOne(u)).insertedId; }
  catch (e) { if (e.code === 11000) return bad(res, 'Email already registered', 409); throw e; }
  await ledger.insertOne({ userId: u._id, kind: 'signup', delta: u.credits, at: new Date() });
  login(res, u);
});

app.post('/api/login', throttle, async (req, res) => {
  const u = await users.findOne({ email: str(req.body.email)?.toLowerCase() });
  if (!u || typeof req.body.password !== 'string' || !(await bcrypt.compare(req.body.password, u.passwordHash)))
    return bad(res, 'Wrong email or password', 401);
  login(res, u);
});

// Same reply whether or not the email exists, so this can't be used to find accounts.
app.post('/api/forgot', throttle, async (req, res) => {
  const token = randomBytes(32).toString('hex');
  const u = await users.findOneAndUpdate({ email: str(req.body.email)?.toLowerCase() },
    { $set: { resetHash: sha(token), resetExp: new Date(Date.now() + 30 * 6e4) } });
  if (u) {
    const link = `${APP_URL}/reset?token=${token}`;
    if (mailer) await mailer.sendMail({ from: MAIL_FROM, to: u.email, subject: 'Reset your StudyMate password',
      text: `Someone asked to reset the password for your StudyMate account.

Reset it here (link expires in 30 minutes):
${link}

If this wasn't you, ignore this email.` });
    else console.log(`[dev] password reset link for ${u.email}: ${link}`);
  }
  res.json({ ok: true });
});

app.post('/api/reset', throttle, async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || !validPw(password)) return bad(res, 'Choose an 8–72 character password');
  const u = await users.findOneAndUpdate({ resetHash: sha(token), resetExp: { $gt: new Date() } },
    { $set: { passwordHash: await bcrypt.hash(password, 12) }, $unset: { resetHash: 1, resetExp: 1 }, $inc: { sv: 1 } },
    { returnDocument: 'after' });
  u ? login(res, u) : bad(res, 'This reset link is invalid or has expired. Request a new one.');
});

app.post('/api/logout', (req, res) => res.clearCookie('token').json({ ok: true }));

app.get('/api/me', auth, async (req, res) => {
  const u = await users.findOne({ _id: req.uid }, { projection: { email: 1, credits: 1, plan: 1 } });
  u ? res.json({ id: u._id, email: u.email, credits: u.credits, plan: u.plan }) : bad(res, 'Not logged in', 401);
});

// ---------- wallet ----------
app.get('/api/wallet', auth, async (req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const [u, history, spent] = await Promise.all([
    users.findOne({ _id: req.uid }, { projection: { credits: 1, plan: 1 } }),
    ledger.find({ userId: req.uid }, { projection: { _id: 0, kind: 1, delta: 1, at: 1 } }).sort({ at: -1 }).limit(50).toArray(),
    ledger.aggregate([
      { $match: { userId: req.uid, delta: { $lt: 0 }, at: { $gte: since } } },
      { $group: { _id: '$kind', tokens: { $sum: { $multiply: ['$delta', -1] } }, calls: { $sum: 1 } } },
    ]).toArray(),
  ]);
  if (!u) return bad(res, 'Not logged in', 401);
  res.json({
    credits: u.credits, plan: u.plan, history, offers: { pack: PACK, pro: PRO },
    spent30: Object.fromEntries(spent.map(s => [s._id, { tokens: s.tokens, calls: s.calls }])),
  });
});

// ---------- notes ----------
app.get('/api/notes', auth, async (req, res) => {
  res.json(await chunks.aggregate([
    { $match: { userId: req.uid } },
    { $sort: { i: 1 } },
    { $group: { _id: '$noteId', title: { $first: '$noteTitle' }, subject: { $first: '$subject' }, chunks: { $sum: 1 }, at: { $first: '$at' },
      source: { $first: '$source' }, pages: { $first: '$pages' }, excerpt: { $first: { $substrCP: ['$text', 0, 220] } } } },
    { $sort: { at: -1 } },
  ]).toArray());
});

app.post('/api/notes', auth, upload.single('file'), async (req, res) => {
  const title = str(req.body.title), subject = str(req.body.subject, 80);
  if (!title || !subject) return bad(res, 'Title and subject required');
  let text = typeof req.body.text === 'string' ? req.body.text : '', pages;
  if (req.file) {
    if (req.file.mimetype !== 'application/pdf') return bad(res, 'Only PDF files');
    try { ({ text, numpages: pages } = await pdf(req.file.buffer)); }
    catch { return bad(res, "Couldn't read that PDF. Is it damaged or password-protected?"); }
  }
  const parts = chunk(text);
  if (!parts.length) return bad(res, 'No readable text (scanned PDFs need OCR)');
  const vectors = await embed(parts);
  const noteId = new ObjectId(), at = new Date(), source = req.file ? 'pdf' : 'text';
  await chunks.insertMany(parts.map((t, i) => ({
    userId: req.uid, noteId, noteTitle: title, subject, source, pages, text: t, embedding: vectors[i], i, at,
  })));
  res.json({ _id: noteId, title, subject, source, pages, chunks: parts.length });
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
  res.json({ answer: text, sources, credits: await charge(db, req.uid, tokens, 'chat') });
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
  const credits = await charge(db, req.uid, tokens, 'quiz');
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
