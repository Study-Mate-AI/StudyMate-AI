import express from 'express';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { createHmac, timingSafeEqual } from 'node:crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_unset');
export const PACK = Number(process.env.PACK_CREDITS || 50000);
export const PRO = Number(process.env.PRO_CREDITS || 200000);

// Credits only ever change here, from signed events. The frontend success redirect is ignored.
export default function billing(db) {
  const r = express.Router();
  r.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    let ev;
    try {
      ev = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      return res.status(400).send(`bad signature: ${e.message}`);
    }
    // Stripe retries deliveries; the unique _id makes each event apply once.
    try { await db.collection('events').insertOne({ _id: ev.id }); }
    catch (e) { if (e.code === 11000) return res.json({ duplicate: true }); throw e; }

    const users = db.collection('users');
    const grant = (userId, kind, delta) => db.collection('ledger').insertOne({ userId, kind, delta, at: new Date() });
    const o = ev.data.object;
    if (ev.type === 'checkout.session.completed' && ObjectId.isValid(o.client_reference_id)) {
      const pro = o.mode === 'subscription', _id = new ObjectId(o.client_reference_id);
      const r = await users.updateOne({ _id }, {
        $inc: { credits: pro ? PRO : PACK },
        $set: { stripeCustomerId: o.customer, ...(pro && { plan: 'pro' }) },
      });
      if (r.matchedCount) await grant(_id, pro ? 'pro' : 'pack', pro ? PRO : PACK);
    } else if (ev.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle') {
      const u = await users.findOneAndUpdate({ stripeCustomerId: o.customer }, { $inc: { credits: PRO }, $set: { plan: 'pro' } });
      if (u) await grant(u._id, 'renewal', PRO);
    } else if (ev.type === 'invoice.payment_failed' && o.billing_reason?.startsWith('subscription')) {
      // Lock Pro: no monthly refill until a retry succeeds (invoice.paid restores 'pro').
      // Tokens already granted were paid for, so the balance stays usable.
      await users.updateOne({ stripeCustomerId: o.customer, plan: 'pro' }, { $set: { plan: 'past_due' } });
    } else if (ev.type === 'customer.subscription.deleted') {
      await users.updateOne({ stripeCustomerId: o.customer }, { $set: { plan: 'free' } });
    }
    res.json({ received: true });
  });
  return r;
}

// ---------- Razorpay (card, UPI, UPI QR) ----------
// Prices in rupees. Pro is one prepaid month per purchase.
// ponytail: no auto-renewal; add Razorpay Subscriptions if Pro must renew itself
export const RZP_PRICE = { pack: Number(process.env.PACK_PRICE_INR || 399), pro: Number(process.env.PRO_PRICE_INR || 749) };
// Razorpay signs order_id|payment_id with the key secret; constant-time compare.
export const rzpValid = (orderId, paymentId, sig, secret) => {
  const want = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return typeof sig === 'string' && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
};

export function razorpay(db, auth) {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = process.env;
  const r = express.Router(), orders = db.collection('orders'), users = db.collection('users');
  r.post('/api/pay/order', auth, async (req, res) => {
    const kind = req.body?.kind;
    if (!RZP_PRICE[kind]) return res.status(400).json({ error: 'Unknown plan' });
    if (!id || !secret) return res.status(503).json({ error: 'Payments aren\'t configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env' });
    const rr = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
      body: JSON.stringify({ amount: RZP_PRICE[kind] * 100, currency: 'INR', notes: { kind, userId: String(req.uid) } }),
    });
    const o = await rr.json();
    if (!rr.ok) return res.status(502).json({ error: o.error?.description || 'Could not start the payment' });
    await orders.insertOne({ _id: o.id, userId: req.uid, kind, amount: o.amount, paid: false, at: new Date() });
    res.json({ key: id, orderId: o.id, amount: o.amount, currency: o.currency });
  });
  r.post('/api/pay/verify', auth, async (req, res) => {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
    if (!secret || !rzpValid(oid, pid, sig, secret)) return res.status(400).json({ error: 'Payment could not be verified' });
    // paid:false in the filter makes each order grant once, even if verify is called twice.
    const o = await orders.findOneAndUpdate({ _id: oid, userId: req.uid, paid: false }, { $set: { paid: true, paymentId: pid } });
    if (o) {
      const delta = o.kind === 'pro' ? PRO : PACK;
      await users.updateOne({ _id: req.uid }, { $inc: { credits: delta }, ...(o.kind === 'pro' && { $set: { plan: 'pro' } }) });
      await db.collection('ledger').insertOne({ userId: req.uid, kind: o.kind, delta, at: new Date() });
    }
    res.json({ ok: true });
  });
  return r;
}
