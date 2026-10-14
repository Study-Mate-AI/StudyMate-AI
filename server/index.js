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
import { MongoClient, ObjectId, GridFSBucket } from 'mongodb';
import pdf from 'pdf-parse/lib/pdf-parse.js'; // lib path: the package root runs a debug test under ESM
import { chunk, cited, embed, generate, readFile, grade, clean, analyze, charge, topicsOf, cosine, quizSchema, DIMS } from './ai.js';
import { docxText, pptxSlides } from './extract.js';
import { cleanProfile } from './profile.js';
import billing, { razorpay, PACK, PRO, RZP_PRICE } from './billing.js';

const { MONGODB_URI, JWT_SECRET, PORT = 3000, SMTP_URL, MAIL_FROM = 'StudyMate <no-reply@studymate.local>', APP_URL = 'http://localhost:5173' } = process.env;
if (!MONGODB_URI || !JWT_SECRET) throw new Error('Set MONGODB_URI and JWT_SECRET in server/.env');

const db = (await new MongoClient(MONGODB_URI).connect()).db('studymate');
const users = db.collection('users');
const chunks = db.collection('chunks');
const convos = db.collection('conversations');
const quizzes = db.collection('quizzes');
const ledger = db.collection('ledger');
const topics = db.collection('topics'); // contents index per note: heading → page range, with an embedding
const files = new GridFSBucket(db, { bucketName: 'files' }); // original PDFs/images, for showing the cited page
const SIGNUP_BONUS = 500; // tokens = 5 credits (1 credit = 100 tokens; the client shows credits)

await users.createIndex({ email: 1 }, { unique: true });
await ledger.createIndex({ userId: 1, at: -1 });
// Tutor sessions: several conversations per subject (the old index allowed one per subject).
await convos.dropIndex('userId_1_subject_1').catch(() => {});
await convos.createIndex({ userId: 1, subject: 1, updatedAt: -1 });
await topics.createIndex({ userId: 1, subject: 1 });
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
// Same account shape as GET /api/me, so pages don't miss fields until a reload.
const me = u => ({ id: u._id, email: u.email, credits: u.credits, plan: u.plan, google: !!u.google, hasPassword: !!u.passwordHash,
  createdAt: u._id.getTimestamp(), profile: u.profile ?? {} });
const login = (res, u) => res.cookie('token', jwt.sign({ id: u._id, sv: u.sv ?? 0 }, JWT_SECRET, { expiresIn: '7d' }), cookieOpts).json(me(u));

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
  u?.credits > 0 ? next() : bad(res, 'Out of credits. Recharge to continue.', 402);
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
  // Name and date of birth go straight into the profile (same validation as Settings → Profile).
  const { profile, error } = cleanProfile({ name: req.body.name, birthDate: req.body.birthDate });
  if (error) return bad(res, error);
  if (!profile.name || !profile.birthDate) return bad(res, 'Enter your name and date of birth');
  const u = { email, passwordHash: await bcrypt.hash(password, 12), credits: SIGNUP_BONUS, plan: 'free', profile };
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

// Google sign-in: verify Google's ID token, then log in, or create the account with the usual 5 free credits.
// ponytail: tokeninfo is one HTTPS call per sign-in; switch to google-auth-library's verifyIdToken if traffic grows
app.post('/api/google', throttle, async (req, res) => {
  if (typeof req.body.credential !== 'string') return bad(res, 'Google sign-in failed', 401);
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.body.credential));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !process.env.GOOGLE_CLIENT_ID || t.aud !== process.env.GOOGLE_CLIENT_ID || t.email_verified !== 'true') return bad(res, 'Google sign-in failed', 401);
  const email = t.email.toLowerCase();
  let u = await users.findOne({ email });
  if (!u) {
    u = { email, credits: SIGNUP_BONUS, plan: 'free', google: true, profile: cleanProfile({ name: t.name }).profile ?? {} }; // name from Google; DOB can be added in Settings
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
  const u = await users.findOne({ _id: req.uid }, { projection: { email: 1, credits: 1, plan: 1, google: 1, passwordHash: 1, profile: 1 } });
  u ? res.json(me(u)) : bad(res, 'Not logged in', 401);
});

// Settings → Profile: name, date of birth, phone, college, course, year. The whole profile is replaced each save.
app.put('/api/profile', auth, async (req, res) => {
  const { profile, error } = cleanProfile(req.body);
  if (error) return bad(res, error);
  await users.updateOne({ _id: req.uid }, { $set: { profile } });
  res.json({ profile });
});

// Settings: change password (Google-only accounts can set a first one). Logs out other devices, keeps this one.
app.post('/api/password', auth, throttle, async (req, res) => {
  const u = await users.findOne({ _id: req.uid });
  if (u.passwordHash && (typeof req.body.current !== 'string' || !(await bcrypt.compare(req.body.current, u.passwordHash))))
    return bad(res, 'Current password is wrong', 401);
  if (!validPw(req.body.password)) return bad(res, 'Choose an 8–72 character password');
  login(res, await users.findOneAndUpdate({ _id: req.uid }, { $set: { passwordHash: await bcrypt.hash(req.body.password, 12) }, $inc: { sv: 1 } }, { returnDocument: 'after' }));
});

app.use(razorpay(db, auth));
// ---------- wallet ----------
// Public plan details for the landing page, from the same settings checkout uses (prices in ₹, credits in tokens).
app.get('/api/plans', (req, res) => res.json({ prices: RZP_PRICE, tokens: { signup: SIGNUP_BONUS, pack: PACK, pro: PRO } }));
app.get('/api/wallet', auth, async (req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const [u, history, spent, usage] = await Promise.all([
    users.findOne({ _id: req.uid }, { projection: { credits: 1, plan: 1 } }),
    ledger.find({ userId: req.uid, delta: { $ne: 0 } }, { projection: { _id: 0, kind: 1, delta: 1, at: 1, title: 1 } }).sort({ at: -1 }).limit(50).toArray(),
    ledger.aggregate([
      { $match: { userId: req.uid, delta: { $lt: 0 }, at: { $gte: since } } },
      { $group: { _id: '$kind', tokens: { $sum: { $multiply: ['$delta', -1] } }, calls: { $sum: 1 } } },
    ]).toArray(),
    ledger.aggregate([
      { $match: { userId: req.uid, kind: { $in: ['chat', 'quiz'] } } },
      { $group: { _id: '$kind', count: { $sum: 1 }, tokens: { $sum: { $multiply: ['$delta', -1] } } } },
    ]).toArray(),
  ]);
  if (!u) return bad(res, 'Not logged in', 401);
  res.json({
    credits: u.credits, plan: u.plan, history, offers: { pack: PACK, pro: PRO }, prices: RZP_PRICE,
    spent30: Object.fromEntries(spent.map(s => [s._id, { tokens: s.tokens, calls: s.calls }])),
    usage: Object.fromEntries(usage.map(s => [s._id, { count: s.count, tokens: s.tokens }])), // all-time queries
  });
});

// ---------- notes ----------
app.get('/api/notes', auth, async (req, res) => {
  res.json(await chunks.aggregate([
    { $match: { userId: req.uid } },
    { $sort: { i: 1 } },
    { $group: { _id: '$noteId', title: { $first: '$noteTitle' }, subject: { $first: '$subject' }, chunks: { $sum: 1 }, at: { $first: '$at' },
      source: { $first: '$source' }, pages: { $first: '$pages' }, file: { $first: '$file' }, excerpt: { $first: { $substrCP: ['$text', 0, 220] } } } },
    { $sort: { at: -1 } },
  ]).toArray());
});

// The note's contents index (built at upload): headings with their page ranges.
app.get('/api/notes/:id/topics', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  res.json(await topics.find({ noteId: new ObjectId(req.params.id), userId: req.uid }, { projection: { _id: 0, title: 1, from: 1, to: 1 } }).sort({ from: 1 }).toArray());
});

// The original PDF/image, so the tutor can show the cited page (browsers open PDFs at #page=N natively).
app.get('/api/notes/:id/file', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const [f] = await files.find({ 'metadata.noteId': new ObjectId(req.params.id), 'metadata.userId': req.uid }).limit(1).toArray();
  if (!f) return bad(res, 'The original file was not kept for this note. Re-upload it to see pages.', 404);
  res.set({ 'Content-Type': f.metadata.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600' });
  files.openDownloadStream(f._id).pipe(res);
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
      if (!(await users.findOne({ _id: req.uid, credits: { $gt: 0 } }))) return bad(res, 'Reading images and scanned PDFs uses credits. Recharge to continue.', 402);
      ({ pages: input, tokens: aiTokens } = await readFile(f.buffer, IMAGE_MIME[ext] || 'application/pdf'));
    }
  }
  const parts = chunk(input);
  if (!parts.length) return bad(res, 'No readable text found in that file');
  const index = pages ? topicsOf(input) : []; // contents: heading → pages
  const vectors = await embed([...parts.map(p => p.text), ...index.map(t => t.title)]);
  const noteId = new ObjectId(), at = new Date();
  // ponytail: originals count toward Atlas's 512 MB free storage; move to object storage if that fills up
  const file = source === 'pdf' || source === 'image';
  if (file) await new Promise((ok, fail) => files.openUploadStream(f.originalname, { metadata: { userId: req.uid, noteId, contentType: IMAGE_MIME[ext] || 'application/pdf' } })
    .on('finish', ok).on('error', fail).end(f.buffer));
  await chunks.insertMany(parts.map((p, i) => ({
    userId: req.uid, noteId, noteTitle: title, subject, source, pages, text: p.text, embedding: vectors[i], i, at, file,
    ...(pages && { page: p.from, pageTo: p.to }), // PDFs and slides: citations show the page/slide
  })));
  if (index.length) await topics.insertMany(index.map((t, k) => ({ userId: req.uid, noteId, subject, ...t, embedding: vectors[parts.length + k] })));
  const credits = aiTokens ? await charge(db, req.uid, aiTokens, 'read', { title, subject }) : undefined;
  res.json({ _id: noteId, title, subject, source, pages, chunks: parts.length, topics: index.length, credits });
});
app.delete('/api/notes/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const noteId = new ObjectId(req.params.id);
  const r = await chunks.deleteMany({ noteId, userId: req.uid });
  await topics.deleteMany({ noteId, userId: req.uid });
  for (const f of await files.find({ 'metadata.noteId': noteId, 'metadata.userId': req.uid }).toArray()) await files.delete(f._id);
  res.json({ deleted: r.deletedCount });
});

// Retrieval goes through the contents index first: if the question matches a heading, that topic's pages are read
// directly (by noteId + page range). Vector search over all chunks fills the remaining slots.
const TOPIC_MATCH = 0.70; // measured: matching heading 0.74–0.80, unrelated ≤ 0.63
const SRC = { noteId: 1, noteTitle: 1, text: 1, page: 1, pageTo: 1, source: 1, file: 1 };
async function retrieve(uid, subject, query, limit = 5) {
  const [v] = await embed([query], 'RETRIEVAL_QUERY');
  const [hits, heads] = await Promise.all([
    chunks.aggregate([
      { $vectorSearch: { index: 'vec', path: 'embedding', queryVector: v, numCandidates: 100, limit, filter: { userId: uid, subject } } },
      { $project: { ...SRC, score: { $meta: 'vectorSearchScore' } } },
    ]).toArray(),
    topics.find({ userId: uid, subject }, { projection: { noteId: 1, title: 1, from: 1, to: 1, embedding: 1 } }).toArray(),
  ]);
  const best = heads.map(t => ({ t, s: cosine(v, t.embedding) })).sort((a, b) => b.s - a.s)[0];
  const direct = best?.s >= TOPIC_MATCH
    ? (await chunks.find({ userId: uid, noteId: best.t.noteId, page: { $lte: best.t.to }, pageTo: { $gte: best.t.from } }, { projection: SRC }).sort({ i: 1 }).limit(2).toArray())
      .map(c => ({ ...c, topic: best.t.title, atPage: Math.max(c.page, best.t.from) })) // open the viewer at the topic's page
    : [];
  const seen = new Set();
  return [...direct, ...hits].filter(c => !seen.has(String(c._id)) && seen.add(String(c._id))).slice(0, limit).map(({ _id, ...c }) => c);
}

// ---------- chat ----------
const NOT_IN_NOTES = "I don't have that in your notes.";
const where = s => s.page ? `${s.noteTitle}, p. ${s.page}${s.pageTo > s.page ? `–${s.pageTo}` : ''}` : s.noteTitle;

// Sessions: each subject has its own list of conversations. (Older single-conversation docs show up as one session.)
app.get('/api/sessions', auth, async (req, res) => {
  res.json(await convos.aggregate([
    { $match: { userId: req.uid, subject: String(req.query.subject) } },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $project: { title: { $ifNull: ['$title', { $first: '$messages.content' }] }, updatedAt: { $ifNull: ['$updatedAt', { $last: '$messages.at' }] }, count: { $size: '$messages' } } },
  ]).toArray());
});
app.get('/api/sessions/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  const c = await convos.findOne({ _id: new ObjectId(req.params.id), userId: req.uid });
  c ? res.json(c.messages) : bad(res, 'Not found', 404);
});
app.delete('/api/sessions/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return bad(res, 'Bad id');
  await convos.deleteOne({ _id: new ObjectId(req.params.id), userId: req.uid });
  res.json({ ok: true });
});

app.post('/api/chat', auth, hasCredits, async (req, res) => {
  const subject = str(req.body.subject, 80), question = str(req.body.question, 2000);
  if (!subject || !question) return bad(res, 'Subject and question required');
  // No sessionId = "New chat": the session is created on its first question, titled by it.
  const sid = ObjectId.isValid(req.body.sessionId) ? new ObjectId(req.body.sessionId) : null;
  const session = sid && await convos.findOne({ _id: sid, userId: req.uid, subject }, { projection: { messages: { $slice: -4 } } });
  if (sid && !session) return bad(res, 'Session not found', 404);
  const history = session?.messages ?? [];
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
  const msgs = [{ role: 'user', content: question, at }, { role: 'assistant', content: answer, sources: marked, tokens, at }];
  const sessionId = session ? sid : (await convos.insertOne({ userId: req.uid, subject, title: question.slice(0, 80), messages: [], at, updatedAt: at })).insertedId;
  await convos.updateOne({ _id: sessionId }, { $push: { messages: { $each: msgs, $slice: -100 } }, $set: { updatedAt: at } });
  res.json({ answer, sources: marked, tokens, sessionId, credits: await charge(db, req.uid, tokens, 'chat', { title: question.slice(0, 120), subject }) });
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
  const credits = await charge(db, req.uid, tokens, 'quiz', { title: topic, subject, difficulty });
  let questions;
  try { questions = clean(JSON.parse(text)).slice(0, n); } catch { questions = []; }
  if (!questions.length) return bad(res, 'Quiz generation failed, try again', 502);
  const quiz = { userId: req.uid, subject, topic, difficulty, grounded, questions, attempts: [], tokens, at: new Date() };
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
// Time for one attempt: first attempt = from quiz generated to submitted; retakes = the test-room timer.
const attemptSecs = { $cond: [{ $eq: ['$n', 0] }, { $round: [{ $divide: [{ $subtract: ['$attempts.at', '$at'] }, 1000] }, 0] }, '$attempts.secs'] };
app.get('/api/stats', auth, async (req, res) => {
  const rows = await quizzes.aggregate([
    { $match: { userId: req.uid } },
    { $unwind: { path: '$attempts', includeArrayIndex: 'n' } },
    { $project: { _id: 0, quizId: '$_id', subject: 1, topic: 1, difficulty: 1, at: '$attempts.at', score: '$attempts.score', total: { $size: '$questions' }, secs: attemptSecs } },
    { $sort: { at: 1 } },
  ]).toArray();
  res.json(analyze(rows));
});

// History for the Progress page: every tutor question and quiz, newest first.
app.get('/api/history', auth, async (req, res) => {
  const [asked, tried] = await Promise.all([
    ledger.find({ userId: req.uid, kind: { $in: ['chat', 'read'] } }).sort({ at: -1 }).limit(500).toArray(),
    quizzes.aggregate([
      { $match: { userId: req.uid } },
      { $unwind: { path: '$attempts', includeArrayIndex: 'n', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, type: 'quiz', quizId: '$_id', title: '$topic', subject: 1, difficulty: 1, score: '$attempts.score', total: { $size: '$questions' },
        secs: attemptSecs, at: { $ifNull: ['$attempts.at', '$at'] }, tokens: { $cond: [{ $lte: [{ $ifNull: ['$n', 0] }, 0] }, '$tokens', 0] } } },
      { $sort: { at: -1 } }, { $limit: 500 },
    ]).toArray(),
  ]);
  const rows = [...asked.map(l => ({ type: l.kind === 'chat' ? 'tutor' : 'upload', title: l.title || (l.kind === 'chat' ? 'Tutor question' : 'File read by AI'),
    subject: l.subject, tokens: -l.delta, at: l.at })), ...tried];
  res.json(rows.sort((a, b) => b.at - a.at).slice(0, 500));
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
