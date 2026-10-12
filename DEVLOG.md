# StudyMate AI — Dev Log

## 2026-10-04

### Commit `78bc673` — Initial build (all 9 modules)
Built from the project plan, with Ponytail keeping it minimal: 4 server files, 6 client files, 6 collections.

- **Auth (M1):** signup, login and logout; passwords hashed with bcrypt; JWT in an httpOnly cookie; 10,000 starter tokens.
- **Notes upload (M2):** PDF via multer + pdf-parse, or pasted text; organised by subject; deleting a note also deletes its chunks.
- **Indexer (M3):** 500-word chunks with 50-word overlap → Gemini embeddings (768 dims) → Atlas Vector Search index, created automatically at startup.
- **AI Tutor (M4):** subject-scoped retrieval of the top 5 chunks; answers come only from the notes with `[Source n]` citations, and it replies "not in your notes" otherwise; history saved per subject.
- **Quiz generator (M6):** Gemini JSON mode, 4-option MCQs, Easy/Medium/Hard; answers are removed before the quiz is sent to the browser.
- **Test room (M7):** graded on the server; returns per-question results and explanations.
- **Progress (M8):** average score per topic, topics below 70% flagged as weak, SVG trend chart, "Practice →" link for weak topics.
- **Billing (M9, first pass):** Stripe Payment Links + signature-verified webhook that applies each event only once.
- `server/check.js` self-check for chunking and grading.

### Commit `0cdb9df` — Module 5 & 9: Token Wallet and Billing

**Server**
- New `ledger` collection: every credit change is logged (`chat`, `quiz`, `signup`, `pack`, `pro`, `renewal`).
- `charge()` deducts actual token usage, never below zero, in one atomic update, and logs the amount actually deducted.
- Webhook grants (token pack, Pro start, Pro renewal) are logged to the ledger.
- `GET /api/wallet`: balance, plan, 30-day spend by type, last 50 activity rows, pack/Pro token amounts.

**Client**
- **Nav credit meter:** animated balance, green/amber/red status dot (amber below 1,000), links to the wallet.
- **Out-of-tokens banner:** shown on every page whenever the server refuses a request for lack of credits (HTTP 402).
- **Wallet page:** large balance, remaining-vs-used bar, tutor/quiz/average-per-answer stats, activity table with relative times.
- **Plans:** Free / Token pack / Pro cards → Stripe Payment Links; Pro users get a "Manage subscription" link to Stripe's Customer Portal.
- **After payment:** the page checks every 2 s for up to ~30 s until the webhook's credit grant appears, then shows a confirmation.
- Token section removed from the Progress page (the wallet replaces it).

**Design**
- Fonts: Geist (UI), Geist Mono (numbers), Instrument Serif (accents).
- Warm paper palette with one green accent; light and dark mode.
- Motion: View Transitions between pages, `@starting-style` card entry, animated meter; all motion is turned off when the device is set to reduce motion.
- Checked at 375 px phone width: no horizontal scroll.

**Config added:** `VITE_STRIPE_PORTAL_LINK`, `VITE_PACK_PRICE`, `VITE_PRO_PRICE` (write the `$` as `\$`). Setup steps are in the README.

### Verified
- `node server/check.js` passes.
- Client build succeeds.
- Wallet page checked in the browser against a temporary fake server with sample data (dark and light mode, phone width).

### Not done yet
- **Never run against a real database or Stripe.** Needs a MongoDB Atlas URI, Gemini key and Stripe test keys in `.env`.
- **No automated test for `charge()`.** It needs a live database, so check it by hand.

### Failed-payment handling (Module 9)
- `invoice.payment_failed` on a subscription → `plan: 'past_due'`: monthly token refills stop. Tokens already paid for stay usable.
- A later successful retry (`invoice.paid`) sets the plan back to `pro` and grants that month's tokens. If Stripe gives up, `customer.subscription.deleted` → `free`.
- Wallet shows a "Your Pro payment failed" alert with an **Update payment method** button (Customer Portal), and the plan badge reads "Pro · payment failed".
- Past-due users don't see "Upgrade to Pro", so they can't start a second subscription.

## 2026-10-06

### Modules 1 & 2: Accounts and Notes refresh

**Server**
- Login/signup limited to 10 attempts per IP every 15 minutes (in-memory, returns 429).
- Passwords capped at 72 bytes (bcrypt silently ignores anything longer).
- PDF uploads record the page count; damaged or password-protected PDFs return a clear 400 instead of a 500.
- Notes list now includes `source` (pdf/text), `pages` and a 220-character excerpt of the extracted text.

**Client**
- **Login/Signup:** split layout with a study-desk hero (ruled notebook page, highlighted passage, cited tutor answer); Log in / Sign up switch, visible labels, show/hide password, strength meter, and a "+10,000 free tokens" card shown during signup.
- **Notes:** PDF/Text switch, drag-and-drop PDF area (title is filled from the filename), ruled text area, subject filter chips, notes grouped by subject as index cards with a coloured top edge, excerpt, page count and age, and a confirm step inside the card before deleting.

### Verified
Playwright end-to-end test against the real server, using an in-memory MongoDB with Gemini embeddings stubbed: signup → 10,000 tokens in wallet and ledger → non-PDF rejected → 2-page PDF uploaded (page count and excerpt shown) → text notes → subject filter → delete (cancel, then confirm) → logout returns 401 → wrong password, then correct → duplicate email gets 409 → 73-character password gets 400 → login throttle returns 429. Checked in light and dark mode at 1280 px and 375 px wide, with no horizontal scroll.

### Forgot password + light/dark toggle
- **Forgot password:** "Forgot password?" link on the login form, then email, then a reset link valid for 30 minutes that works once (only its SHA-256 hash is stored). The reply is the same whether or not the email exists, so it can't be used to find accounts. The link opens `/reset?token=…`, sets the new password and logs you in. Emails go through nodemailer when `SMTP_URL` is set; otherwise the link is printed to the server console.
- **Every other device logged out after a reset:** the login cookie now carries a session version that a password reset increases, and `auth` checks it on every request (one indexed lookup).
- **Light/dark toggle** in the nav and on the login page. Colours use CSS `light-dark()`, so the toggle only sets `data-theme` on `<html>`. The choice is saved in localStorage and applied before the first paint; with no choice saved, the system setting is followed.
- Verified with Playwright: dark mode survives a reload, an unknown email gets the same reply, reset logs you in and removes the token from the URL, the old session gets 401, reusing the link gets 400, the old password is rejected and the new one works. The earlier end-to-end test still passes.

### Modules 6, 7 & 8: Quiz generator, Test room, Progress analytics

**Server**
- **Quiz generator:** questions are checked before saving: exactly 4 different options, a valid answer index and an explanation, otherwise the question is dropped. Options are shuffled on the server because LLMs put the right answer in slot A/B too often. Explanations are written as 2–4 numbered steps.
- **"General knowledge" source:** a quiz on any topic without notes, using Gemini's own knowledge (`grounded: false`). Quizzes from notes still use only the notes.
- `GET /api/quizzes`: past quizzes with attempt count, best score and last score.
- `GET /api/quiz/:id` hides answers until the first submission; after that it returns the latest attempt so it can be reviewed again later.
- Each attempt stores the time taken. Anything that isn't a whole number is stored as `null` (unanswered).
- `GET /api/stats` → `analyze()`: totals, accuracy by difficulty, per topic (average, last-3 average, change since the first attempt), and the last 30 attempts. **Weak = the last 3 attempts average under 70%**, so improving clears the flag.
- New index on `quizzes { userId, at }`.

**Client**
- **Quiz:** topic, source (a subject or General knowledge), 5/10/15 switch, difficulty cards; "Your quizzes" history with best score and a Start/Review link.
- **Test room:** A–D option cards, a bar pinned to the bottom showing answered count and timer, and a warning if questions are left unanswered. Results show score, time, a pass/fail verdict, correct and wrong answers marked, step-by-step explanations, a "Mistakes only" filter, Retake, and "New quiz on this topic".
- **Progress:** stat tiles, accuracy chart with a hover tooltip and a 70% line (drawn at real pixel size, so labels stay readable on phones), weak topics with a Practice link that pre-fills the quiz form, accuracy by difficulty, all-topics table (Avg / Last 3 / Change / Status), recent attempts.
- Subject colours and the `ago()` helper moved to `App.jsx`, so Notes, Quiz and Progress use the same subject colour.

### Verified
- `node server/check.js`: new checks for `clean()` (malformed questions dropped, the shuffled answer still points to the right option, positions vary) and `analyze()`.
- End-to-end against local MongoDB with Gemini and `$vectorSearch` replaced by stand-ins: answers hidden before the first attempt, 400/404 on bad input, tokens deducted, unanswered questions counted as wrong, review shown after reload, Practice link pre-fills the form. No horizontal scroll at 375 px; checked in light and dark mode.
- **Not tested with real Gemini output.** Needs a `GEMINI_API_KEY` and an Atlas URI in `server/.env`.

## 2026-10-07

### Modules 3 & 4: Note splitter / AI indexer and AI tutor

**Server – indexer (M3)**
- `chunk()` takes plain text or a list of PDF pages. Each chunk records the pages it covers (`page`, `pageTo`), so citations can say "Lecture 4, p. 3–4". Empty pages keep the numbering correct.
- PDF pages are collected one by one while pdf-parse reads them, not by splitting the text afterwards. Some PDFs contain form-feed characters in their own text, which made one 5-page test file look like 16 pages.
- Embeddings use Gemini task types: notes as `RETRIEVAL_DOCUMENT`, questions as `RETRIEVAL_QUERY`.
- Retrieval also returns `noteId`, page range and the vector search score.

**Server – tutor (M4)**
- **Follow-up questions:** the last 6 messages go into the prompt. A short follow-up (under 8 words, e.g. "explain simpler") is searched together with the previous question.
- **No matching notes → no Gemini call:** the fixed reply "I don't have that in your notes." costs 0 tokens.
- New `cited()` helper finds which sources the answer used (`[Source 2]`, `[Source 1, 3]`, `[Sources 1, 2]`). Each source comes back with `cited: true/false`.
- Answers are short and clear: a direct answer, then paragraphs or bullet points with key terms in bold, and a citation after each fact. Each saved answer also stores its token cost.
- `DELETE /api/chat/:subject` clears a conversation. Each saved conversation keeps only its latest 100 messages (MongoDB's 16 MB document limit).

**Client**
- **Tutor page:** subject chips (the subject is kept in the URL as `?subject=`), chat bubbles, a small formatter for answers (paragraphs, lists, **bold**, `code`), and numbered citation buttons that open the source text with its note title and pages.
- Sources the answer used are listed under it. Ones it didn't use sit behind "+N more". Token cost is shown for each answer.
- Empty chat shows starter questions. The question box grows as you type: Enter sends, Shift+Enter adds a new line. Animated dots while it answers; a failed question goes back into the box. Clear chat asks for confirmation.
- **Notes:** each subject group has an "Ask tutor →" link.

### Verified
- `node server/check.js`: new checks for page ranges across PDF pages (including an empty page) and for `cited()`.
- Page splitting tested against pdf-parse's sample PDFs: same text as before, correct page count.
- End-to-end against local MongoDB with Gemini and `$vectorSearch` replaced by stand-ins: PDF upload stores page ranges, embeddings use the right task types, follow-up prompts include the conversation, a subject without notes returns the fixed reply for 0 tokens, input over 2,000 characters gets 400, clear chat works. UI checked with Enter to send, citation buttons, "+N more", starter questions, the Notes → Tutor link, light and dark mode, and a 375 px phone width with no horizontal scroll.
- **Not tested with real Gemini or Atlas.** Notes uploaded before this change have no page numbers. Re-upload them to get page citations and the better search.

### Gemini model update
- Tested with a real Gemini key: `gemini-2.5-flash` now returns 404 for new API keys, and `gemini-3.8-flash` / `gemini-flash-latest` kept returning 503 (overloaded) during testing. The default is now **`gemini-3.5-flash`**: real quiz JSON came back valid (2/2 questions passed `clean()`, ~14 s). Override it with `GEMINI_MODEL` in `server/.env`.
- `retry()` now also retries once on 503, not just 429.
- `gemini-embedding-001` works with the new key (768 dims).

## 2026-10-08

### Token efficiency
Measured with real Gemini (`gemini-3.5-flash`) on Research Methodology notes:

| | Before | After |
|---|---|---|
| Tutor answer | ~3,900 tokens (5 chunks + "thinking") | ~2,000 tokens |
| Quiz, 5 questions | ~5,700 tokens (thinking was 2,300 of it) | ~3,300 tokens, all 5 questions still valid |

- Gemini's "thinking" turned off (`thinkingBudget: 0`). Note: Pro models can't turn thinking off.
- Tutor sends the 3 best-matching chunks (was 5); each chunk costs about 650 tokens.
- Chat history sent to Gemini: last 4 messages, 500 characters each (was 6 × 1,500).
- Quiz notes depend on question count: 4 chunks for 5 questions, 6 for 15 (was always 8).

### Gemini API key pool
- `GEMINI_API_KEY` accepts several comma-separated keys. `retry()` in `ai.js` rotates through them round-robin; on 429 (rate limit), 503 (overloaded) or 403 (rejected key) it moves to the next key, and if all fail it waits 2 s and tries once more. Other errors (e.g. 400) are thrown straight away.
- Built into the server instead of running LiteLLM (a separate Python service) – same effect for Gemini, no extra process.
- Raises capacity (rate limits) roughly ×N for N keys from different projects. It does **not** lower tokens per request or what the wallet charges.
- Verified: `check.js` (rotation, failover, no retry on 400) and a live call with the real key through the pool.

### LiteLLM proxy (Docker)
- `litellm/docker-compose.yml` + `litellm/config.yaml`: LiteLLM container on :4000 (`ghcr.io/berriai/litellm:main-stable`), models `chat` (gemini-3.5-flash) and `embed` (gemini-embedding-001), load-balanced across `GEMINI_KEY_n` entries, 2 retries. Keys live in gitignored `litellm/.env`.
- `ai.js`: when `LITELLM_URL` is set, `generate()` and `embed()` call LiteLLM's OpenAI-style API (thinking disabled, quiz schema sent as JSON Schema). Without it, Gemini is called directly as before.
- If the proxy is down the app says "The AI service is offline. Start Docker Desktop...".
- Verified: embeddings through LiteLLM are identical to direct ones (cosine 1.0000), so existing notes keep working; full flow (signup, PDF upload, tutor with citations, 5-question quiz) passed through the proxy.

### Wallet charge: prompt at 1/4
- `cost()` in `ai.js`: answer tokens at full rate, prompt tokens (mostly the notes) at 1/4, matching Gemini's input-vs-output pricing. Works for both the direct and the LiteLLM path.
- Measured: a tutor answer now charges ~630 tokens (was ~2,000; ~3,900 before the first optimisation). A 5-question quiz ≈ 1,400.
- 10,000 free tokens ≈ 15 tutor answers or 7 quizzes.

### Landing page
- New public page at `/` (`client/src/pages/Landing.jsx`); `/login` and `/signup` open the login form in that mode, `/reset` links still work. Logged-out users see the landing page first.
- Sections: sticky nav (blurs on scroll), hero, subject marquee, features grid, how it works, stats, pricing, FAQ, final call to action, footer.
- Motion, CSS + a little React, no new libraries: hero words rise in, drifting gradient blobs, the product preview tilts with the pointer, the highlighter sweeps across the note, the tutor answer types out, sections reveal on scroll (IntersectionObserver), number counters, cursor spotlight on feature cards, shine on the main button, rotating border on the final call to action. All of it is turned off when the device asks for reduced motion.
- `client/e2e/landing.spec.js` (Playwright): desktop light/dark and 375 px phone. Checks no console errors, no horizontal scroll, every reveal section ends up visible, and "Start free" opens signup. Run with `npx playwright test` while the client dev server is running. 4/4 pass.

## 2026-10-09

### Google sign-in
- "Continue with Google" button on the landing page (Google Identity Services script in `index.html`, `GoogleButton` in `App.jsx`). No new npm packages.
- `POST /api/google`: checks Google's ID token with Google's `tokeninfo` endpoint. It must belong to our Client ID (`aud` matches) and have a verified email. The server then logs in the user with that email, or creates the account with 10,000 tokens and a ledger entry. Same login cookie as password login.
- Accounts made with Google have no password. Password login on them now returns "Wrong email or password" instead of crashing; "Forgot password" can set one.
- Settings: `GOOGLE_CLIENT_ID` in `server/.env` and `VITE_GOOGLE_CLIENT_ID` in `client/.env` (same public Client ID, OAuth Web client, origins `http://localhost` and `http://localhost:5173`).
- Playwright: the button renders, and a fake token gets 401. 6/6 tests pass. The real Google login itself has to be clicked by a person.
- Login and signup forms also show "Continue with Google", below an "or" divider under the main button. Hidden on the forgot and reset screens. Playwright checks both pages.
- `vite.config.js`: `port: 5173, strictPort: true`. Vite had quietly moved to 5174 when 5173 was busy, and Google then refused sign-in (`origin_mismatch`).

### More upload types: Word, PowerPoint, images, text, scanned PDFs
- Notes accept **.pdf, .docx, .pptx, .txt, .md, .png, .jpg/.jpeg, .webp** (10 MB limit as before). Old binary .doc/.ppt are refused with "save as .docx/.pptx first".
- `server/extract.js`: .docx/.pptx are zip archives of XML, read with Node's zlib (small zip reader, no new npm packages). PowerPoint keeps one text per slide, so citations point at slide numbers.
- Images and **scanned PDFs** (no text layer) are read by Gemini (`readFile()` in `ai.js`, sent as inline data; works through LiteLLM too). Gemini marks each page so page numbers survive. This costs tokens (measured ~310 for a photo, ~180 per scanned page), is charged as "File read by AI", and needs a balance above 0. Everything else is still indexed free.
- Notes page: "File" tab, accepts the new types, file badge shows the type, "slides" for PowerPoint, wallet meter updates after an AI read.
- Verified: `check.js` builds .docx/.pptx in memory and checks extraction (XML entities, slide order 2 < 10, wrong-format files rejected) and the page splitting. End-to-end against Atlas + Gemini: docx, pptx, txt, a photo of notes and a scanned PDF all uploaded and stored with the right text and pages, .doc refused. Playwright UI run: File tab, upload of .pptx and a photo, .ppt message, no page errors.

## 2026-10-12

### Razorpay checkout: card, UPI, UPI QR
- Wallet "Buy tokens" / "Upgrade to Pro" open Razorpay Checkout (script in `index.html`, no npm package) limited to three options: **Card**, **UPI** (UPI ID or app) and **UPI QR** to scan.
- `POST /api/pay/order` creates a Razorpay order (INR, `PACK_PRICE_INR`/`PRO_PRICE_INR`, defaults ₹399/₹749) and stores it in `orders`. `POST /api/pay/verify` checks Razorpay's HMAC signature, marks the order paid once (`paid:false` filter), grants tokens and logs to the ledger.
- Pro = one prepaid month per purchase, no auto-renewal. Stripe webhook code left in place, no longer linked from the UI.
- Settings: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` in `server/.env` (test keys from the Razorpay dashboard, Test mode).
- Verified: `check.js` signature check, client build. **Not yet run with real Razorpay test keys.**
