import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../App.jsx';

const pct = x => Math.round(x * 100) + '%';
// Stripe Payment Links (test mode); client_reference_id lets the webhook find the user.
const PACK = import.meta.env.VITE_STRIPE_PACK_LINK;
const PRO = import.meta.env.VITE_STRIPE_PRO_LINK;

export default function Dashboard({ user }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { api('/stats').then(setStats); }, []);
  if (!stats) return <p className="muted">Loading…</p>;
  const weak = stats.topics.filter(t => t.weak);
  const link = (base, label) => base && <a href={`${base}?client_reference_id=${user.id}&prefilled_email=${encodeURIComponent(user.email)}`}
    style={{ background: 'var(--accent)', color: 'var(--bg)', padding: '8px 12px', borderRadius: 8, fontWeight: 600, textDecoration: 'none' }}>{label}</a>;

  return <>
    <h2>Progress</h2>
    {!stats.trend.length && <p className="muted">Take a quiz to see your progress here.</p>}

    {stats.trend.length > 1 && <div className="card"><h3 style={{ marginTop: 0 }}>Accuracy over time</h3><Trend points={stats.trend} /></div>}

    {weak.length > 0 && <div className="card">
      <h3 style={{ marginTop: 0 }} className="bad">Weak topics (below 70%)</h3>
      {weak.map(t => <p key={t.subject + t.topic}>
        {t.topic} <span className="muted">· {t.subject} · {pct(t.avg)}</span>{' '}
        <Link to={`/quiz?subject=${encodeURIComponent(t.subject)}&topic=${encodeURIComponent(t.topic)}`}>Practice →</Link>
      </p>)}
    </div>}

    {stats.topics.length > 0 && <div className="card">
      <h3 style={{ marginTop: 0 }}>All topics</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Topic</th><th align="left">Subject</th><th align="right">Avg</th><th align="right">Attempts</th></tr></thead>
        <tbody>{stats.topics.map(t => <tr key={t.subject + t.topic}>
          <td>{t.topic}</td><td className="muted">{t.subject}</td>
          <td align="right" className={t.weak ? 'bad' : 'good'}>{pct(t.avg)}</td><td align="right">{t.attempts}</td>
        </tr>)}</tbody>
      </table>
    </div>}

    <div className="card">
      <h3 style={{ marginTop: 0 }}>Tokens</h3>
      <p>{user.credits.toLocaleString()} left · plan: {user.plan}</p>
      <div style={{ display: 'flex', gap: 8 }}>{link(PACK, 'Buy token pack')}{user.plan !== 'pro' && link(PRO, 'Upgrade to Pro')}</div>
      {!PACK && !PRO && <p className="muted">Set VITE_STRIPE_PACK_LINK / VITE_STRIPE_PRO_LINK in client/.env to enable payments.</p>}
    </div>
  </>;
}

// ponytail: hand-rolled SVG line chart, swap in Recharts if the dashboard grows more charts
function Trend({ points }) {
  const W = 600, H = 160, P = 24;
  const x = i => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = v => H - P - v * (H - 2 * P);
  const line = points.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Accuracy trend, latest ${pct(points.at(-1).pct)}`}>
    <line x1={P} x2={W - P} y1={y(0.7)} y2={y(0.7)} stroke="var(--bad)" strokeDasharray="4 4" opacity=".6" />
    <text x={W - P} y={y(0.7) - 4} textAnchor="end" fontSize="11" fill="var(--muted)">70%</text>
    <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
    {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.pct)} r="4" fill="var(--accent)"><title>{`${p.topic}: ${pct(p.pct)} · ${new Date(p.at).toLocaleDateString()}`}</title></circle>)}
  </svg>;
}
