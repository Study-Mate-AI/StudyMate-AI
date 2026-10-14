import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useTween, LOW, cr, left, AVG } from '../App.jsx';

// Razorpay Checkout (script in index.html): card, UPI ID / UPI apps, and a UPI QR to scan.
const METHODS = { display: {
  blocks: { pay: { name: 'Pay with', instruments: [{ method: 'card' }, { method: 'upi', flows: ['collect', 'intent'] }, { method: 'upi', flows: ['qr'] }] } },
  sequence: ['block.pay'], preferences: { show_default_blocks: false },
} };

const KIND = {
  chat: 'Tutor answer', quiz: 'Quiz generated', signup: 'Welcome bonus',
  pack: 'Credit pack', pro: 'Pro plan started', renewal: 'Pro renewal', read: 'File read by AI',
};
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(d) {
  const s = (new Date(d) - Date.now()) / 1000;
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}

export default function Wallet({ user, setCredits }) {
  const [w, setW] = useState(null);
  const [params, setParams] = useSearchParams();
  const [confirming, setConfirming] = useState(params.has('paid'));
  const [payErr, setPayErr] = useState('');

  const load = () => api('/wallet').then(d => { setW(d); setCredits(d.credits); return d; });
  useEffect(() => { load(); }, []);

  // Stripe's redirect can beat the webhook; poll briefly until the grant lands in the ledger.
  useEffect(() => {
    if (!confirming) return;
    let tries = 0;
    const t = setInterval(async () => {
      const d = await load().catch(() => null);
      const granted = d?.history[0]?.delta > 0 && ['pack', 'pro', 'renewal'].includes(d.history[0].kind) && Date.now() - new Date(d.history[0].at) < 120e3;
      if (granted || ++tries > 15) { clearInterval(t); setConfirming(granted ? 'done' : 'slow'); setParams({}, { replace: true }); }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const balance = useTween(w?.credits ?? user.credits, 900);
  if (!w) return <p className="muted">Loading wallet…</p>;

  const chat = w.spent30.chat?.tokens ?? 0, quiz = w.spent30.quiz?.tokens ?? 0, used = chat + quiz;
  // Average cost per query from the user's own history (falls back to typical costs until they have some).
  const u = w.usage || {};
  const avgChat = u.chat?.count ? Math.max(1, Math.round(u.chat.tokens / u.chat.count)) : AVG.chat;
  const avgQuiz = u.quiz?.count ? Math.max(1, Math.round(u.quiz.tokens / u.quiz.count)) : AVG.quiz;
  const pctLeft = w.credits + used ? w.credits / (w.credits + used) : 0;
  const low = w.credits < LOW;
  const subscribed = w.plan === 'pro' || w.plan === 'past_due';
  const pay = async kind => {
    setPayErr('');
    try {
      if (!window.Razorpay) throw new Error("Payment page didn't load. Check your connection and try again.");
      const o = await api('/pay/order', { body: { kind } });
      new window.Razorpay({
        key: o.key, order_id: o.orderId, amount: o.amount, currency: o.currency,
        name: 'StudyMate AI', description: kind === 'pro' ? 'Pro · one month' : 'Credit pack',
        prefill: { email: user.email }, theme: { color: '#3f8f6b' }, config: METHODS,
        handler: async r => { setConfirming(true); await api('/pay/verify', { body: r }).catch(e => setPayErr(e.message)); await load(); setConfirming('done'); },
      }).on('payment.failed', r => setPayErr(r.error?.description || 'Payment failed')).open();
    } catch (e) { setPayErr(e.message); }
  };

  return <>
    <p className="eyebrow">Wallet</p>
    <h2>Your <em>credits</em></h2>

    {confirming && <div role="status" className="card rise" style={{ borderColor: confirming === 'slow' ? 'var(--warn)' : 'var(--accent)', background: confirming === 'slow' ? 'var(--warn-soft)' : 'var(--accent-soft)' }}>
      {confirming === true && <><Spinner /> Confirming your payment…</>}
      {confirming === 'done' && <>Payment received. Your credits are ready.</>}
      {confirming === 'slow' && <>The payment is taking longer than usual. Your credits will appear here as soon as the payment is confirmed.</>}
    </div>}

    {w.plan === 'past_due' && <div role="alert" className="card rise" style={{ borderColor: 'var(--bad)', background: 'var(--warn-soft)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        <strong style={{ color: 'var(--bad)' }}>Your Pro payment failed.</strong> Monthly credits are paused until it goes through.
        Your current balance still works. Buy another Pro month below to continue.
      </span>
    </div>}

    <section className="card rise" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontSize: 'clamp(44px, 9vw, 64px)', fontWeight: 500, lineHeight: 1 }}>{cr(balance)}</span>
        <span className="muted">credits available</span>
        <span className="eyebrow" style={{ marginLeft: 'auto', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line-2)', color: { pro: 'var(--accent)', past_due: 'var(--bad)' }[w.plan] }}>
          {{ pro: 'Pro plan', past_due: 'Pro · payment failed' }[w.plan] || 'Free plan'}
        </span>
      </div>

      <div role="meter" aria-label="Credits remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctLeft * 100)}
        style={{ height: 8, borderRadius: 8, background: 'var(--line)', margin: '22px 0 10px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pctLeft * 100}%`, borderRadius: 8, background: low ? 'var(--warn)' : 'var(--accent)', transition: 'width 1s var(--ease)' }} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        <span className="num">{cr(used)}</span> credits used in the last 30 days · 1 credit = 100 AI tokens
        {low && <span style={{ color: 'var(--warn)' }}> · running low, top up below</span>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1, marginTop: 24, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
        <Stat label="Questions left" value={`≈ ${left(w.credits, avgChat)}`} sub={`tutor questions at ~${cr(avgChat)} credits each`} />
        <Stat label="Quizzes left" value={`≈ ${left(w.credits, avgQuiz)}`} sub={`5-question quizzes at ~${cr(avgQuiz)} credits each`} />
        <Stat label="Questions asked" value={(u.chat?.count ?? 0).toLocaleString()} sub={`all time · ${cr(u.chat?.tokens)} credits`} />
        <Stat label="Quizzes made" value={(u.quiz?.count ?? 0).toLocaleString()} sub={`all time · ${cr(u.quiz?.tokens)} credits`} />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '14px 0 0' }}>
        You're charged for what each request actually uses, not a flat fee. A question your notes can't answer is free, and uploading notes is free.
        If a request costs more than you have left, it still finishes and your balance stops at 0.
      </p>
    </section>

    <p className="eyebrow" style={{ marginTop: 40 }}>Recharge</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
      <Plan title="Free" price="₹0" note="to start" current={!subscribed}
        points={['5 credits on signup', 'Every feature included', 'Top up anytime']} />
      <Plan title="Credit pack" price={`₹${w.prices.pack}`} note="one-time"
        points={[`${cr(w.offers.pack)} credits (≈ ${left(w.offers.pack, avgChat)} questions)`, 'Never expire', 'Stacks with any plan']}
        action={<button onClick={() => pay('pack')}>Buy credits</button>} />
      <Plan title="Pro" price={`₹${w.prices.pro}`} note="per month" featured current={subscribed}
        points={[`${cr(w.offers.pro)} credits for the month (≈ ${left(w.offers.pro, avgChat)} questions)`, 'Unused credits carry over', 'No auto-renewal']}
        action={<button className="btn accent" onClick={() => pay('pro')}>{subscribed ? 'Add another month' : 'Upgrade to Pro'}</button>} />
    </div>
    {payErr && <p role="alert" style={{ fontSize: 13, color: 'var(--bad)' }}>{payErr}</p>}
    <p className="muted" style={{ fontSize: 13 }}>Pay by card, UPI ID / UPI app, or scan a UPI QR code. Secured by Razorpay.</p>

    <p className="eyebrow" style={{ marginTop: 40 }}>Activity</p>
    <section className="card rise">
      {!w.history.length ? <p className="muted" style={{ margin: 0 }}>No activity yet.</p> :
        <table>
          <thead><tr><th>Event</th><th>When</th><th style={{ textAlign: 'right' }}>Credits</th></tr></thead>
          <tbody>{w.history.map((h, i) => <tr key={i}>
            <td>{KIND[h.kind] || h.kind}{h.title && <div className="muted" style={{ fontSize: 12.5, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>}</td>
            <td className="muted" title={new Date(h.at).toLocaleString()}>{ago(h.at)}</td>
            <td className="num" style={{ textAlign: 'right', color: h.delta > 0 ? 'var(--good)' : 'var(--ink-2)' }}>{h.delta > 0 ? '+' : '−'}{cr(Math.abs(h.delta))}</td>
          </tr>)}</tbody>
        </table>}
    </section>
  </>;
}

const Stat = ({ label, value, sub }) => <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
  <div className="eyebrow">{label}</div>
  <div className="num" style={{ fontSize: 22, marginTop: 8 }}>{value}</div>
  {sub && <div className="muted" style={{ fontSize: 13 }}>{sub}</div>}
</div>;

function Plan({ title, price, note, points, action, featured, current }) {
  return <div className="card rise" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 22,
    borderColor: featured ? 'var(--accent)' : undefined, boxShadow: featured ? '0 0 0 1px var(--accent)' : undefined }}>
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <strong>{title}</strong>
      {current && <span className="eyebrow" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>Current</span>}
    </div>
    <div><span className="serif" style={{ fontSize: 40, lineHeight: 1 }}>{price}</span> <span className="muted">{note}</span></div>
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 14, color: 'var(--ink-2)', flex: 1 }}>
      {points.map(p => <li key={p} style={{ display: 'flex', gap: 8 }}><span aria-hidden style={{ color: 'var(--accent)' }}>—</span>{p}</li>)}
    </ul>
    {action}
  </div>;
}

const Spinner = () => <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }}>
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 100" strokeLinecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
  </circle>
</svg>;
