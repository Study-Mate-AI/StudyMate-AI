import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useSubjects, hueOf, ago } from '../App.jsx';

const pct = x => Math.round(x * 100) + '%';
const practice = t => `/quiz?subject=${encodeURIComponent(t.subject)}&topic=${encodeURIComponent(t.topic)}&difficulty=${t.recent < 0.5 ? 'Easy' : 'Medium'}`;

const css = `
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; margin-bottom: 12px; }
.kpis > div { background: var(--surface); padding: 16px 18px; }
.kpis .num { font-size: 28px; margin-top: 8px; line-height: 1.1; }
.bar { height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; }
.bar > div { height: 100%; border-radius: 6px; transition: width .8s var(--ease); }
.weak-row { display: grid; grid-template-columns: 1fr 120px auto; gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
.weak-row:first-of-type { border-top: 0; }
@media (max-width: 560px) { .weak-row { grid-template-columns: 1fr auto; } .weak-row .bar { display: none; } .hide-sm { display: none; } }
.status { font: 500 11px/1 var(--mono); letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.tip { position: absolute; pointer-events: none; transform: translate(-50%, calc(-100% - 12px)); background: var(--ink); color: var(--paper); padding: 7px 10px; border-radius: 7px;
  font-size: 12px; line-height: 1.4; white-space: nowrap; box-shadow: 0 8px 20px -10px rgb(0 0 0 / .5); }
`;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  const subjects = useSubjects();
  useEffect(() => { api('/stats').then(setStats, x => setErr(x.message)); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!stats) return <p className="muted">Loading…</p>;
  const { totals, topics, trend, byDifficulty } = stats;
  const weak = topics.filter(t => t.weak);
  const tint = s => ({ '--h': hueOf(subjects, s) });

  return <>
    <style>{css}</style>
    <p className="eyebrow">Progress</p>
    <h2>Your <em>report card</em></h2>

    {!totals.attempts && <div className="card ruled" style={{ textAlign: 'center', padding: '56px 20px', lineHeight: '28px' }}>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '-6px 0 0' }}>Nothing graded yet.</p>
      <p className="muted" style={{ margin: '6px 0 14px' }}>Take a quiz and your accuracy, weak topics and trends show up here.</p>
      <Link className="btn" to="/quiz" viewTransition>Take a quiz</Link>
    </div>}

    {totals.attempts > 0 && <>
      <div className="kpis rise">
        <div><div className="eyebrow">Accuracy</div><div className="num" style={{ color: totals.accuracy < 0.7 ? 'var(--bad)' : undefined }}>{pct(totals.accuracy)}</div><div className="muted" style={{ fontSize: 13 }}>across all answers</div></div>
        <div><div className="eyebrow">Quizzes taken</div><div className="num">{totals.attempts}</div><div className="muted" style={{ fontSize: 13 }}>{topics.length} topic{topics.length === 1 ? '' : 's'}</div></div>
        <div><div className="eyebrow">Questions</div><div className="num">{totals.correct}<span className="muted" style={{ fontSize: 18 }}>/{totals.questions}</span></div><div className="muted" style={{ fontSize: 13 }}>answered correctly</div></div>
        <div><div className="eyebrow">Weak topics</div><div className="num" style={{ color: weak.length ? 'var(--bad)' : 'var(--good)' }}>{weak.length}</div><div className="muted" style={{ fontSize: 13 }}>{weak.length ? 'need revision' : 'all on track'}</div></div>
      </div>

      {trend.length > 1 && <section className="card rise">
        <h3 style={{ margin: '0 0 2px', fontSize: 16 }}>Accuracy over time</h3>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Each point is one quiz attempt{trend.length >= 30 && ' (last 30)'}.</p>
        <Trend points={trend} />
      </section>}

      {weak.length > 0 && <section className="card rise" style={{ borderColor: 'color-mix(in srgb, var(--bad) 45%, var(--line))' }}>
        <h3 style={{ margin: '0 0 2px', fontSize: 16 }}><span aria-hidden className="bad">⚑ </span>Weak topics</h3>
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Your last 3 attempts average under 70%. Score 70% or higher to clear the flag.</p>
        {weak.map(t => <div className="weak-row tint" key={t.subject + t.topic} style={tint(t.subject)}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontWeight: 500 }}>{t.topic}</strong>
            <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" />{t.subject} · {t.attempts} attempt{t.attempts === 1 ? '' : 's'}</div>
          </div>
          <div className="bar" title={`Recent average ${pct(t.recent)}`}><div style={{ width: pct(t.recent), background: 'var(--bad)' }} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="num bad">{pct(t.recent)}</span>
            <Link className="btn" to={practice(t)} viewTransition style={{ padding: '6px 11px', fontSize: 13 }}>Practice</Link>
          </div>
        </div>)}
      </section>}

      <section className="card rise">
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>By difficulty</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {Object.entries(byDifficulty).map(([d, s]) => <div key={d} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 12, alignItems: 'center', fontSize: 14 }}>
            <span>{d}</span>
            <div className="bar" style={{ height: 8 }}><div style={{ width: pct(s.accuracy), background: 'var(--accent)' }} /></div>
            <span className="num" style={{ textAlign: 'right' }}>{s.attempts ? pct(s.accuracy) : <span className="muted">no data</span>}</span>
          </div>)}
        </div>
      </section>

      <section className="card rise">
        <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>All topics</h3>
        <table>
          <thead><tr><th>Topic</th><th style={{ textAlign: 'right' }}>Avg</th><th style={{ textAlign: 'right' }}>Last 3</th><th className="hide-sm" style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
          <tbody>{topics.map(t => <tr key={t.subject + t.topic} className="tint" style={tint(t.subject)}>
            <td>
              {t.topic}
              <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 6, height: 6 }} />{t.subject} · {t.attempts}×</div>
            </td>
            <td className="num" style={{ textAlign: 'right' }}>{pct(t.avg)}</td>
            <td className="num" style={{ textAlign: 'right' }}>{pct(t.recent)}</td>
            <td className="num hide-sm" style={{ textAlign: 'right', color: t.change > 0 ? 'var(--good)' : t.change < 0 ? 'var(--bad)' : 'var(--ink-3)' }}>
              {t.attempts < 2 ? '—' : `${t.change > 0 ? '▲' : t.change < 0 ? '▼' : ''} ${Math.abs(Math.round(t.change * 100))}`}
            </td>
            <td style={{ textAlign: 'right' }}>{t.weak ? <span className="status bad">⚑ Weak</span> : <span className="status good">✓ On track</span>}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="card rise">
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Recent attempts</h3>
        <table><tbody>{trend.slice(-5).reverse().map((a, i) => <tr key={i}>
          <td><Link to={'/quiz/' + a.quizId} viewTransition style={{ color: 'var(--ink)' }}>{a.topic}</Link> <span className="muted" style={{ fontSize: 13 }}>· {a.difficulty}</span></td>
          <td className="muted" style={{ fontSize: 13 }} title={new Date(a.at).toLocaleString()}>{ago(a.at)}</td>
          <td className="num" style={{ textAlign: 'right', color: a.pct < 0.7 ? 'var(--bad)' : 'var(--good)' }}>{a.score}/{a.total}</td>
        </tr>)}</tbody></table>
      </section>
    </>}
  </>;
}

// ponytail: hand-rolled SVG line chart, swap in Recharts if the dashboard grows more charts
function Trend({ points }) {
  const [hover, setHover] = useState(null);
  const [W, setW] = useState(640);
  const box = useRef();
  // Draw in real pixels so labels stay 11px on a phone instead of shrinking with a viewBox.
  useLayoutEffect(() => {
    setW(Math.max(200, box.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const H = 200, L = 34, R = 12, T = 12, B = 22;
  const x = i => L + (i * (W - L - R)) / (points.length - 1);
  const y = v => T + (1 - v) * (H - T - B);
  const move = e => {
    const i = Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left - L) / ((W - L - R) / (points.length - 1)));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover != null && points[hover];
  return <div ref={box} style={{ position: 'relative' }}>
    <svg width={W} height={H} role="img" aria-label={`Accuracy over ${points.length} attempts, latest ${pct(points.at(-1).pct)}`}
      onMouseMove={move} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
      {[0, 0.5, 1].map(v => <g key={v}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
        <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">{v * 100}%</text>
      </g>)}
      <line x1={L} x2={W - R} y1={y(0.7)} y2={y(0.7)} stroke="var(--bad)" strokeDasharray="4 4" opacity=".55" />
      <text x={W - R} y={y(0.7) - 6} textAnchor="end" fontSize="11" fill="var(--ink-3)">70% · weak below</text>
      <polyline points={points.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {h && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-2)" />}
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.pct)} r={i === hover ? 6 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />)}
    </svg>
    {h && <div className="tip" style={{ left: Math.min(Math.max(x(hover), 90), W - 90), top: y(h.pct) }}>
      <strong>{pct(h.pct)}</strong> · {h.score}/{h.total} · {h.difficulty}<br /><span style={{ opacity: .75 }}>{h.topic} · {new Date(h.at).toLocaleDateString()}</span>
    </div>}
  </div>;
}
