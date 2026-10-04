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
