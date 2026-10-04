import express from 'express';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_unset');
const PACK = Number(process.env.PACK_CREDITS || 50000);
const PRO = Number(process.env.PRO_CREDITS || 200000);

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
    const o = ev.data.object;
    if (ev.type === 'checkout.session.completed' && ObjectId.isValid(o.client_reference_id)) {
      const pro = o.mode === 'subscription';
      await users.updateOne({ _id: new ObjectId(o.client_reference_id) }, {
        $inc: { credits: pro ? PRO : PACK },
        $set: { stripeCustomerId: o.customer, ...(pro && { plan: 'pro' }) },
      });
    } else if (ev.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle') {
      await users.updateOne({ stripeCustomerId: o.customer }, { $inc: { credits: PRO }, $set: { plan: 'pro' } });
    } else if (ev.type === 'customer.subscription.deleted') {
      await users.updateOne({ stripeCustomerId: o.customer }, { $set: { plan: 'free' } });
    }
    res.json({ received: true });
  });
  return r;
}
