import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useTween, LOW } from '../App.jsx';

// Stripe Payment Links (test mode). Set the link's "after payment" redirect to <app>/wallet?paid=1.
const env = import.meta.env;
const LINKS = { pack: env.VITE_STRIPE_PACK_LINK, pro: env.VITE_STRIPE_PRO_LINK, portal: env.VITE_STRIPE_PORTAL_LINK };
const PRICE = { pack: env.VITE_PACK_PRICE || '$5', pro: env.VITE_PRO_PRICE || '$9' };

const KIND = {
  chat: 'Tutor answer', quiz: 'Quiz generated', signup: 'Welcome bonus',
  pack: 'Token pack', pro: 'Pro plan started', renewal: 'Pro renewal',
};
const fmt = n => n.toLocaleString();
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
  const pctLeft = w.credits + used ? w.credits / (w.credits + used) : 0;
  const low = w.credits < LOW;
  const subscribed = w.plan === 'pro' || w.plan === 'past_due';
  const pay = kind => LINKS[kind] && `${LINKS[kind]}?client_reference_id=${user.id}&prefilled_email=${encodeURIComponent(user.email)}`;

  return <>
    <p className="eyebrow">Wallet</p>
    <h2>Your <em>tokens</em></h2>

    {confirming && <div role="status" className="card rise" style={{ borderColor: confirming === 'slow' ? 'var(--warn)' : 'var(--accent)', background: confirming === 'slow' ? 'var(--warn-soft)' : 'var(--accent-soft)' }}>
      {confirming === true && <><Spinner /> Confirming your payment with Stripe…</>}
      {confirming === 'done' && <>Payment received. Your tokens are ready.</>}
      {confirming === 'slow' && <>Stripe is taking longer than usual. Your tokens will appear here as soon as the payment is confirmed.</>}
    </div>}

    {w.plan === 'past_due' && <div role="alert" className="card rise" style={{ borderColor: 'var(--bad)', background: 'var(--warn-soft)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        <strong style={{ color: 'var(--bad)' }}>Your Pro payment failed.</strong> Monthly tokens are paused until it goes through.
        Your current balance still works, and Stripe will retry the card automatically.
      </span>
      {LINKS.portal && <a className="btn" href={LINKS.portal}>Update payment method</a>}
    </div>}

    <section className="card rise" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontSize: 'clamp(44px, 9vw, 64px)', fontWeight: 500, lineHeight: 1 }}>{fmt(balance)}</span>
        <span className="muted">tokens available</span>
        <span className="eyebrow" style={{ marginLeft: 'auto', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line-2)', color: { pro: 'var(--accent)', past_due: 'var(--bad)' }[w.plan] }}>
          {{ pro: 'Pro plan', past_due: 'Pro · payment failed' }[w.plan] || 'Free plan'}
        </span>
      </div>

      <div role="meter" aria-label="Tokens remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctLeft * 100)}
        style={{ height: 8, borderRadius: 8, background: 'var(--line)', margin: '22px 0 10px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pctLeft * 100}%`, borderRadius: 8, background: low ? 'var(--warn)' : 'var(--accent)', transition: 'width 1s var(--ease)' }} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        <span className="num">{fmt(used)}</span> used in the last 30 days
        {low && <span style={{ color: 'var(--warn)' }}> · running low, top up below</span>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1, marginTop: 24, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
        <Stat label="Tutor answers" tokens={chat} calls={w.spent30.chat?.calls} />
        <Stat label="Quizzes" tokens={quiz} calls={w.spent30.quiz?.calls} />
        <Stat label="Avg per answer" tokens={w.spent30.chat?.calls ? Math.round(chat / w.spent30.chat.calls) : 0} />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '14px 0 0' }}>
        You're charged for the AI tokens each request actually uses, not a flat fee per message. Uploading and indexing notes is free.
      </p>
    </section>

    <p className="eyebrow" style={{ marginTop: 40 }}>Recharge</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
      <Plan title="Free" price="$0" note="to start" current={!subscribed}
        points={['10,000 tokens on signup', 'Every feature included', 'Top up anytime']} />
      <Plan title="Token pack" price={PRICE.pack} note="one-time"
        points={[`${fmt(w.offers.pack)} tokens`, 'Never expire', 'Stacks with any plan']}
        action={<Pay href={pay('pack')} label="Buy tokens" />} />
      <Plan title="Pro" price={PRICE.pro} note="per month" featured current={subscribed}
        points={[`${fmt(w.offers.pro)} tokens every month`, 'Unused tokens carry over', 'Cancel anytime']}
        action={subscribed
          ? LINKS.portal && <a className="btn ghost" href={LINKS.portal}>{w.plan === 'past_due' ? 'Update payment method' : 'Manage subscription'}</a>
          : <Pay href={pay('pro')} label="Upgrade to Pro" accent />} />
    </div>
    {!LINKS.pack && !LINKS.pro && <p className="muted" style={{ fontSize: 13 }}>Payments aren't configured: set VITE_STRIPE_PACK_LINK and VITE_STRIPE_PRO_LINK in client/.env.</p>}

    <p className="eyebrow" style={{ marginTop: 40 }}>Activity</p>
    <section className="card rise">
      {!w.history.length ? <p className="muted" style={{ margin: 0 }}>No activity yet.</p> :
        <table>
          <thead><tr><th>Event</th><th>When</th><th style={{ textAlign: 'right' }}>Tokens</th></tr></thead>
          <tbody>{w.history.map((h, i) => <tr key={i}>
            <td>{KIND[h.kind] || h.kind}</td>
            <td className="muted" title={new Date(h.at).toLocaleString()}>{ago(h.at)}</td>
            <td className="num" style={{ textAlign: 'right', color: h.delta > 0 ? 'var(--good)' : 'var(--ink-2)' }}>{h.delta > 0 ? '+' : '−'}{fmt(Math.abs(h.delta))}</td>
          </tr>)}</tbody>
        </table>}
    </section>
  </>;
}

const Stat = ({ label, tokens, calls }) => <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
  <div className="eyebrow">{label}</div>
  <div className="num" style={{ fontSize: 22, marginTop: 8 }}>{tokens.toLocaleString()}</div>
  {calls != null && <div className="muted" style={{ fontSize: 13 }}>{calls} request{calls === 1 ? '' : 's'}</div>}
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

const Pay = ({ href, label, accent }) => href
  ? <a className={'btn' + (accent ? ' accent' : '')} href={href}>{label}</a>
  : <button disabled title="Payment link not configured">{label}</button>;

const Spinner = () => <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }}>
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 100" strokeLinecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
  </circle>
</svg>;
