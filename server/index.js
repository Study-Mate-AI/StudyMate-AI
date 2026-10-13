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
import { chunk, cited, embed, generate, readFile, grade, clean, analyze, charge, quizSchema, DIMS } from './ai.js';
import { docxText, pptxSlides } from './extract.js';
import billing, { razorpay, PACK, PRO, RZP_PRICE } from './billing.js';

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
await quizzes.createIndex({ userId: 1, at: -1 });
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
// pdf-parse's own page text (same line → joined, new line → \n). Pages render in order, so the caller can collect them.
const pageText = page => page.getTextContent().then(c => {
  let lastY, text = '';
  for (const it of c.items) { text += lastY === undefined || lastY === it.transform[5] ? it.str : '\n' + it.str; lastY = it.transform[5]; }
  return text;
}).catch(() => '');
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
  if (!u || !u.passwordHash || typeof req.body.password !== 'string' || !(await bcrypt.compare(req.body.password, u.passwordHash)))
    return bad(res, 'Wrong email or password', 401);
  login(res, u);
});

// Google sign-in: verify Google's ID token, then log in, or create the account with the usual 10,000 tokens.
// ponytail: tokeninfo is one HTTPS call per sign-in; switch to google-auth-library's verifyIdToken if traffic grows
app.post('/api/google', throttle, async (req, res) => {
  if (typeof req.body.credential !== 'string') return bad(res, 'Google sign-in failed', 401);
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.body.credential));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !process.env.GOOGLE_CLIENT_ID || t.aud !== process.env.GOOGLE_CLIENT_ID || t.email_verified !== 'true') return bad(res, 'Google sign-in failed', 401);
  const email = t.email.toLowerCase();
  let u = await users.findOne({ email });
  if (!u) {
    u = { email, credits: 10000, plan: 'free', google: true };
    try {
      u._id = (await users.insertOne(u)).insertedId;
      await ledger.insertOne({ userId: u._id, kind: 'signup', delta: u.credits, at: new Date() });
    } catch (e) { if (e.code !== 11000) throw e; u = await users.findOne({ email }); } // double click: account already made
  }
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

app.use(razorpay(db, auth));
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
    credits: u.credits, plan: u.plan, history, offers: { pack: PACK, pro: PRO }, prices: RZP_PRICE,
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

// Upload types by file extension. Images (and PDFs with no text layer, i.e. scans) are read by Gemini.
const TYPES = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', txt: 'text', md: 'text', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image' };
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

app.post('/api/notes', auth, upload.single('file'), async (req, res) => {
  const title = str(req.body.title), subject = str(req.body.subject, 80);
  if (!title || !subject) return bad(res, 'Title and subject required');
  const f = req.file, ext = f?.originalname.split('.').pop().toLowerCase();
  let input = typeof req.body.text === 'string' ? req.body.text : '', pages, source = 'text', aiTokens = 0;
  if (f) {
    source = TYPES[ext];
    if (!source) return bad(res, 'Supported files: PDF, Word (.docx), PowerPoint (.pptx), images (PNG, JPG, WebP) and text (.txt, .md)');
    try {
      if (source === 'pdf') {
        const pageTexts = [];
        ({ numpages: pages } = await pdf(f.buffer, { pagerender: p => pageText(p).then(t => (pageTexts.push(t), t)) }));
        input = pageTexts;
      } else if (source === 'docx') input = docxText(f.buffer);
      else if (source === 'pptx') { input = pptxSlides(f.buffer); pages = input.length; }
      else if (source === 'text') input = f.buffer.toString('utf8');
    } catch { return bad(res, "Couldn't read that file. Is it damaged or password-protected?"); }
    // Images and scanned PDFs need Gemini to read them, which uses tokens, so they need a balance.
    if (source === 'image' || (source === 'pdf' && !chunk(input).length)) {
      if (!(await users.findOne({ _id: req.uid, credits: { $gt: 0 } }))) return bad(res, 'Reading images and scanned PDFs uses AI tokens. Recharge to continue.', 402);
      ({ pages: input, tokens: aiTokens } = await readFile(f.buffer, IMAGE_MIME[ext] || 'application/pdf'));
    }
  }
  const parts = chunk(input);
  if (!parts.length) return bad(res, 'No readable text found in that file');
  const vectors = await embed(parts.map(p => p.text));
  const noteId = new ObjectId(), at = new Date();
  await chunks.insertMany(parts.map((p, i) => ({
    userId: req.uid, noteId, noteTitle: title, subject, source, pages, text: p.text, embedding: vectors[i], i, at,
    ...(pages && { page: p.from, pageTo: p.to }), // PDFs and slides: citations show the page/slide
  })));
  const credits = aiTokens ? await charge(db, req.uid, aiTokens, 'read') : undefined;
  res.json({ _id: noteId, title, subject, source, pages, chunks: parts.length, credits });
});
app.delete('/api/notes/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const r = await chunks.deleteMany({ noteId: new ObjectId(req.params.id), userId: req.uid });
  res.json({ deleted: r.deletedCount });
});

async function retrieve(uid, subject, query, limit = 5) {
  const [v] = await embed([query], 'RETRIEVAL_QUERY');
  return chunks.aggregate([
    { $vectorSearch: { index: 'vec', path: 'embedding', queryVector: v, numCandidates: 100, limit, filter: { userId: uid, subject } } },
    { $project: { _id: 0, noteId: 1, noteTitle: 1, text: 1, page: 1, pageTo: 1, score: { $meta: 'vectorSearchScore' } } },
  ]).toArray();
}

// ---------- chat ----------
const NOT_IN_NOTES = "I don't have that in your notes.";
const where = s => s.page ? `${s.noteTitle}, p. ${s.page}${s.pageTo > s.page ? `–${s.pageTo}` : ''}` : s.noteTitle;

app.get('/api/chat/:subject', auth, async (req, res) => {
  const c = await convos.findOne({ userId: req.uid, subject: req.params.subject });
  res.json(c?.messages ?? []);
});

app.delete('/api/chat/:subject', auth, async (req, res) => {
  await convos.deleteOne({ userId: req.uid, subject: req.params.subject });
  res.json({ ok: true });
});

app.post('/api/chat', auth, hasCredits, async (req, res) => {
  const subject = str(req.body.subject, 80), question = str(req.body.question, 2000);
  if (!subject || !question) return bad(res, 'Subject and question required');
  const history = (await convos.findOne({ userId: req.uid, subject }, { projection: { messages: { $slice: -4 } } }))?.messages ?? [];
  // A short follow-up ("explain that simpler") has nothing to search on, so it borrows the previous question.
  // ponytail: word-count heuristic, ask Gemini to rewrite the query if follow-ups still miss
  const prev = history.findLast(m => m.role === 'user')?.content;
  const sources = await retrieve(req.uid, subject, prev && question.split(/\s+/).length < 8 ? `${prev}\n${question}` : question, 3); // 3 chunks ≈ 2k tokens; each extra one costs ~650
  let answer = NOT_IN_NOTES, tokens = 0;
  if (sources.length) {
    ({ text: answer, tokens } = await generate(
      `You are a friendly study tutor. Answer ONLY from the student's notes below; never use outside knowledge.
After each fact, cite the note it came from like [Source 2]. If the notes don't contain the answer, reply exactly: "${NOT_IN_NOTES}"
Keep it short and clear: a direct answer first, then short paragraphs or "- " bullet points. Use **bold** for key terms. No headings.

NOTES:
${sources.map((s, i) => `[Source ${i + 1}] (${where(s)})\n${s.text}`).join('\n\n')}

CONVERSATION SO FAR (for context only, the notes are the only source of facts):
${history.map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 500)}`).join('\n') || '(none)'}

STUDENT: ${question}`));
  }
  const used = cited(answer);
  const marked = sources.map((s, i) => ({ ...s, cited: used.has(i + 1) }));
  const at = new Date();
  // Cap the stored thread so one long conversation can't grow toward Mongo's 16 MB document limit.
  await convos.updateOne({ userId: req.uid, subject }, { $push: { messages: { $each: [
    { role: 'user', content: question, at },
    { role: 'assistant', content: answer, sources: marked, tokens, at },
  ], $slice: -100 } } }, { upsert: true });
  res.json({ answer, sources: marked, tokens, credits: await charge(db, req.uid, tokens, 'chat') });
});

// ---------- quizzes ----------
const GENERAL = 'General knowledge'; // quiz without notes: Gemini's own knowledge, flagged grounded: false
const hideAnswers = q => ({ ...q, questions: q.questions.map(({ q: text, options }) => ({ q: text, options })) });

app.post('/api/quiz', auth, hasCredits, async (req, res) => {
  const subject = str(req.body.subject, 80) || GENERAL, topic = str(req.body.topic, 120);
  const difficulty = ['Easy', 'Medium', 'Hard'].includes(req.body.difficulty) ? req.body.difficulty : 'Medium';
  const n = Math.min(Math.max(Number(req.body.n) || 5, 1), 15);
  if (!topic) return bad(res, 'Topic required');
  const grounded = subject !== GENERAL;
  const sources = grounded ? await retrieve(req.uid, subject, topic, 3 + Math.ceil(n / 5)) : []; // 4 chunks for 5 Qs, 6 for 15
  if (grounded && !sources.length) return bad(res, 'No notes found for this subject yet');
  const level = { Easy: 'direct recall of a single fact', Medium: 'understanding and applying one concept', Hard: 'connecting two or more concepts, with plausible distractors' }[difficulty];
  const { text, tokens } = await generate(
    `Write ${n} multiple-choice questions on "${topic}" ${grounded ? 'using ONLY the notes below' : 'using accurate, standard textbook knowledge'}. Difficulty: ${difficulty} (${level}).
Each has exactly 4 distinct options and exactly one correct option; "answer" is the 0-based index of the correct option.
"explanation" walks through the reasoning step by step as 2-4 short numbered lines ("1. ...\n2. ..."), ending with why the correct option is right${grounded ? ', and cites the notes' : ''}.
${grounded ? `\nNOTES:\n${sources.map(s => s.text).join('\n\n')}` : ''}`, quizSchema);
  const credits = await charge(db, req.uid, tokens, 'quiz');
  let questions;
  try { questions = clean(JSON.parse(text)).slice(0, n); } catch { questions = []; }
  if (!questions.length) return bad(res, 'Quiz generation failed, try again', 502);
  const quiz = { userId: req.uid, subject, topic, difficulty, grounded, questions, attempts: [], at: new Date() };
  quiz._id = (await quizzes.insertOne(quiz)).insertedId;
  res.json({ ...hideAnswers(quiz), credits });
});

app.get('/api/quizzes', auth, async (req, res) => {
  res.json(await quizzes.aggregate([
    { $match: { userId: req.uid } },
    { $sort: { at: -1 } },
    { $limit: 50 },
    { $project: { subject: 1, topic: 1, difficulty: 1, at: 1, total: { $size: '$questions' }, attempts: { $size: '$attempts' },
      best: { $max: '$attempts.score' }, last: { $last: '$attempts.score' } } },
  ]).toArray());
});

// Answers stay hidden until the student has submitted once; after that the latest attempt comes back for review.
app.get('/api/quiz/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const q = await quizzes.findOne({ _id: new ObjectId(req.params.id), userId: req.uid });
  if (!q) return bad(res, 'Not found', 404);
  const { attempts, ...rest } = q, last = attempts.at(-1);
  res.json({ ...hideAnswers(rest), attempts: attempts.length, best: attempts.length ? Math.max(...attempts.map(a => a.score)) : null,
    last: last && { ...grade(q.questions, last.answers), answers: last.answers, secs: last.secs, at: last.at, total: q.questions.length } });
});

app.post('/api/quiz/:id/attempt', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id) || !Array.isArray(req.body.answers)) return bad(res, 'Bad request');
  const _id = new ObjectId(req.params.id);
  const q = await quizzes.findOne({ _id, userId: req.uid });
  if (!q) return bad(res, 'Not found', 404);
  const answers = q.questions.map((_, i) => Number.isInteger(req.body.answers[i]) ? req.body.answers[i] : null);
  const secs = Math.min(Math.max(Math.round(Number(req.body.secs)) || 0, 0), 86400);
  const { results, score } = grade(q.questions, answers);
  await quizzes.updateOne({ _id }, { $push: { attempts: { answers, score, secs, at: new Date() } } });
  res.json({ score, total: q.questions.length, results, answers, secs });
});

// ---------- analytics ----------
app.get('/api/stats', auth, async (req, res) => {
  const rows = await quizzes.aggregate([
    { $match: { userId: req.uid } },
    { $unwind: '$attempts' },
    { $project: { _id: 0, quizId: '$_id', subject: 1, topic: 1, difficulty: 1, at: '$attempts.at', score: '$attempts.score', total: { $size: '$questions' } } },
    { $sort: { at: 1 } },
  ]).toArray();
  res.json(analyze(rows));
});

// Production: serve the built client from the same origin.
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html'))); // SPA routes on refresh
app.use((err, req, res, next) => {
  console.error(err);
  if (err.codeName === 'SearchNotEnabled') // local MongoDB (demo mode) has no $vectorSearch
    return bad(res, 'Searching notes needs MongoDB Atlas. Set MONGODB_URI in server/.env to your Atlas cluster.', 503);
  if (err.message?.startsWith('LiteLLM proxy not reachable'))
    return bad(res, 'The AI service is offline. Start Docker Desktop and run "docker compose up -d" in the litellm folder.', 503);
  if (err.status === 429 || err.status === 503) // Gemini rate limit / overloaded, already retried once in ai.js
    return bad(res, 'The AI is busy right now. Please try again in a minute.', 503);
  bad(res, 'Server error', 500);
});
app.listen(PORT, () => console.log(`StudyMate API on :${PORT}`));
