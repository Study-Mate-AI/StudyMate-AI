# StudyMate AI

RAG study assistant: upload notes → grounded chat with citations → AI quizzes → weak-topic dashboard → Stripe top-ups.

## Setup
1. **MongoDB Atlas** (free M0): create a cluster and copy the connection string. The vector index is created automatically on first start.
2. **Gemini API key**: https://aistudio.google.com/apikey
3. `cp server/.env.example server/.env` and fill it in.
4. Run, in two terminals:
   ```
   cd server && npm install && npm run dev
   cd client && npm install && npm run dev
   ```
   Open http://localhost:5173

## Payments (optional, test mode)
1. In the Stripe dashboard, create two Payment Links: a one-time token pack and a monthly Pro subscription.
2. Put them in `client/.env`:
   ```
   VITE_STRIPE_PACK_LINK=https://buy.stripe.com/test_...
   VITE_STRIPE_PRO_LINK=https://buy.stripe.com/test_...
   ```
3. Forward webhooks: `stripe listen --forward-to localhost:3000/webhook`, then put the `whsec_...` it prints into `server/.env`.
4. Pay with test card 4242 4242 4242 4242.

## Check
`cd server && npm run check` tests chunking and grading.

## Production
`cd client && npm run build`, then `cd server && npm start` serves the API and the built client on :3000.
