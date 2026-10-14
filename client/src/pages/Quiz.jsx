import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useSubjects, hueOf, ago } from '../App.jsx';

const GENERAL = 'General knowledge'; // matches the server: a quiz not built from notes
const LEVELS = { Easy: 'Recall single facts', Medium: 'Understand and apply', Hard: 'Connect several ideas' };
const pct = (s, t) => Math.round(100 * s / t);
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const css = `
.levels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.level { display: grid; gap: 2px; text-align: left; justify-items: start; justify-content: stretch; padding: 12px 14px; background: var(--surface); color: var(--ink); border: 1px solid var(--line-2); }
.level small { color: var(--ink-3); font-weight: 400; font-size: 12px; }
.level[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent); }
.level .bars { display: flex; gap: 2px; margin-bottom: 6px; } .level .bars i { width: 4px; height: 10px; border-radius: 2px; background: var(--line-2); }
.level .bars i.on { background: var(--accent); }
@media (max-width: 520px) { .levels { grid-template-columns: 1fr; } }
.qrow { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
.qrow:first-child { border-top: 0; }
.score-tag { font: 500 12px/1 var(--mono); padding: 5px 7px; border-radius: 5px; border: 1px solid var(--line-2); white-space: nowrap; }
.qcard { border: 1px solid var(--line); padding: 20px; margin: 0 0 12px; scroll-margin-top: 80px; }
.qcard legend { float: left; width: 100%; padding: 0; margin-bottom: 14px; font-weight: 600; font-size: 16px; display: flex; gap: 12px; }
.qcard legend .num { color: var(--ink-3); font-weight: 500; }
.choice { display: flex; align-items: center; gap: 12px; padding: 11px 12px; margin-top: 6px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
  transition: border-color .15s, background .15s; }
.choice:hover { border-color: var(--line-2); background: color-mix(in srgb, var(--line) 50%, transparent); }
.choice input { position: absolute; opacity: 0; pointer-events: none; }
.choice .key { flex: none; width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; font: 600 12px/1 var(--mono); border: 1px solid var(--line-2); color: var(--ink-2); }
.choice:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.choice:has(input:checked) .key { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.choice:has(input:focus-visible) { box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.choice.right { border-color: var(--good); background: color-mix(in srgb, var(--good) 10%, transparent); }
.choice.right .key { background: var(--good); border-color: var(--good); color: var(--surface); }
.choice.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 9%, transparent); }
.choice.wrong .key { background: var(--bad); border-color: var(--bad); color: var(--surface); }
.choice[aria-disabled] { cursor: default; }
.choice .tag-r { margin-left: auto; font: 500 11px/1 var(--mono); letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.explain { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: var(--paper); border-left: 3px solid var(--c, var(--line-2)); white-space: pre-wrap; font-size: 14px; color: var(--ink-2); }
.dock { position: sticky; bottom: 12px; z-index: 4; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 14px; margin-top: 16px;
  background: color-mix(in srgb, var(--surface) 90%, transparent); backdrop-filter: blur(12px); border: 1px solid var(--line-2); border-radius: 12px;
  box-shadow: 0 12px 30px -18px rgb(0 0 0 / .4); }
.meter { flex: 1; min-width: 120px; height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; }
.meter > div { height: 100%; background: var(--accent); border-radius: 6px; transition: width .4s var(--ease); }
`;

export default function Quiz({ setCredits }) {
  const { id } = useParams();
  return <><style>{css}</style>{id ? <TestRoom key={id} id={id} /> : <Generate setCredits={setCredits} />}</>;
}

function Generate({ setCredits }) {
  const subjects = useSubjects();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [difficulty, setDifficulty] = useState(LEVELS[params.get('difficulty')] ? params.get('difficulty') : 'Medium');
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [history, setHistory] = useState(null);
  useEffect(() => { api('/quizzes').then(setHistory, () => setHistory([])); }, []);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const q = await api('/quiz', { body: { ...Object.fromEntries(new FormData(e.target)), difficulty, n } });
      setCredits(q.credits);
      nav('/quiz/' + q._id, { viewTransition: true });
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  const want = params.get('subject');
  const options = [...subjects, GENERAL];
  return <>
    <p className="eyebrow">Quiz</p>
    <h2 style={{ marginBottom: 6 }}>Test <em>yourself</em></h2>
    <p className="muted" style={{ margin: '0 0 24px' }}>Gemini writes multiple-choice questions from your notes, with a worked explanation for every answer.</p>

    <form className="card rise" onSubmit={submit} style={{ display: 'grid', gap: 16, padding: 20 }}>
      <label className="field">Topic
        <input name="topic" placeholder="e.g. Photosynthesis, Newton's laws, SQL joins" defaultValue={params.get('topic') || ''} required maxLength={120} style={{ fontSize: 16 }} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
        {/* key: the default must apply once subjects arrive */}
        <label className="field" key={options.length}>Source
          <select name="subject" defaultValue={options.includes(want) ? want : options[0]}>
            {subjects.length > 0 && <optgroup label="Your notes">{subjects.map(s => <option key={s}>{s}</option>)}</optgroup>}
            <option value={GENERAL}>General knowledge (no notes)</option>
          </select>
        </label>
        <div className="field">Questions
          <div className="seg" role="group" aria-label="Number of questions">
            {[5, 10, 15].map(k => <button type="button" key={k} aria-pressed={n === k} onClick={() => setN(k)} className="num">{k}</button>)}
          </div>
        </div>
      </div>
      <div className="field">Difficulty
        <div className="levels" role="group" aria-label="Difficulty">
          {Object.entries(LEVELS).map(([d, blurb], i) => <button type="button" key={d} className="level" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
            <span className="bars" aria-hidden>{[0, 1, 2].map(b => <i key={b} className={b <= i ? 'on' : ''} />)}</span>
            {d}<small>{blurb}</small>
          </button>)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button disabled={busy}>{busy ? <><Spinner /> Writing {n} questions…</> : 'Generate quiz'}</button>
        {err ? <span role="alert" className="err" style={{ fontSize: 14 }}>{err}</span>
          : <span className="muted" style={{ fontSize: 13 }}>{subjects.length ? 'Uses credits to write the quiz. Taking it is free.' : <>No notes yet. <Link to="/notes" viewTransition>Upload some</Link> to get quizzes built from them.</>}</span>}
      </div>
    </form>

    {history?.length > 0 && <>
      <p className="eyebrow" style={{ marginTop: 40 }}>Your quizzes</p>
      <section className="card rise" style={{ padding: '6px 18px' }}>
        {history.map(q => <div className="qrow tint" key={q._id} style={{ '--h': hueOf(subjects, q.subject) }}>
          <span className="dot" style={q.subject === GENERAL ? { background: 'var(--ink-3)' } : undefined} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={'/quiz/' + q._id} viewTransition style={{ color: 'var(--ink)', fontWeight: 500, textDecoration: 'none' }}>{q.topic}</Link>
            <div className="muted" style={{ fontSize: 13 }}>{q.subject} · {q.difficulty} · {q.total} Qs · {ago(q.at)}</div>
          </div>
          {q.attempts
            ? <span className="score-tag" title={`${q.attempts} attempt${q.attempts === 1 ? '' : 's'}`} style={{ color: pct(q.best, q.total) >= 70 ? 'var(--good)' : 'var(--bad)' }}>Best {q.best}/{q.total}</span>
            : <span className="score-tag muted">New</span>}
          <Link to={'/quiz/' + q._id} viewTransition className="btn ghost" style={{ padding: '5px 10px', fontSize: 13 }}>{q.attempts ? 'Review' : 'Start'}</Link>
        </div>)}
      </section>
    </>}
  </>;
}

function TestRoom({ id }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [start, setStart] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mistakes, setMistakes] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/quiz/' + id).then(q => { setQuiz(q); if (q.last) { setResult(q.last); setAnswers(q.last.answers); } }, x => setErr(x.message));
  }, [id]);
  useEffect(() => {
    if (!quiz || result) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [quiz, result]);

  if (err && !quiz) return <p className="err">{err}</p>;
  if (!quiz) return <p className="muted">Loading quiz…</p>;

  const total = quiz.questions.length;
  const answered = quiz.questions.filter((_, i) => answers[i] != null).length;
  const secs = Math.round((now - start) / 1000);

  const submit = async e => {
    e.preventDefault();
    if (answered < total && !confirm) {
      setConfirm(true);
      document.getElementById('q' + quiz.questions.findIndex((_, i) => answers[i] == null))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true); setErr('');
    try {
      const r = await api(`/quiz/${id}/attempt`, { body: { answers: quiz.questions.map((_, i) => answers[i] ?? null), secs } });
      setResult(r); setQuiz(q => ({ ...q, attempts: q.attempts + 1, best: Math.max(q.best ?? 0, r.score) }));
      scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) { setErr(x.message); }
    setBusy(false); setConfirm(false);
  };
  const retake = () => { setResult(null); setAnswers([]); setMistakes(false); setStart(Date.now()); setNow(Date.now()); scrollTo({ top: 0 }); };

  const p = result && pct(result.score, result.total);
  const verdict = p >= 90 ? 'Excellent work.' : p >= 70 ? 'Passed. Keep it up.' : 'Needs revision. This topic is flagged as weak on your Progress page.';
  const again = `/quiz?subject=${encodeURIComponent(quiz.subject)}&topic=${encodeURIComponent(quiz.topic)}&difficulty=${quiz.difficulty}`;

  return <form onSubmit={submit} style={{ display: 'block' }}>
    <p className="eyebrow">{quiz.subject} · {quiz.difficulty} · {total} questions{quiz.grounded === false && ' · not from your notes'}</p>
    <h2>{quiz.topic}</h2>

    {result && <section className="card rise" role="status" style={{ padding: 24, borderColor: p >= 70 ? 'var(--good)' : 'var(--bad)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontSize: 'clamp(40px, 8vw, 56px)', fontWeight: 500, lineHeight: 1 }}>{result.score}<span className="muted">/{result.total}</span></span>
        <span className="num" style={{ fontSize: 22, color: p >= 70 ? 'var(--good)' : 'var(--bad)' }}>{p}%</span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 14 }}>
          {result.secs > 0 && <>Time <span className="num">{clock(result.secs)}</span></>}
          {quiz.attempts > 1 && <> · Best <span className="num">{quiz.best}/{total}</span> over {quiz.attempts} attempts</>}
        </span>
      </div>
      <div className="meter" style={{ margin: '16px 0 12px', height: 8 }}><div style={{ width: p + '%', background: p >= 70 ? 'var(--good)' : 'var(--bad)' }} /></div>
      <p style={{ margin: '0 0 16px' }}>{verdict}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={retake}>Retake quiz</button>
        <Link className="btn ghost" to={again} viewTransition>New quiz on this topic</Link>
        <Link className="btn ghost" to="/dashboard" viewTransition>See progress</Link>
        {result.score < result.total && <button type="button" className="chip" aria-pressed={mistakes} onClick={() => setMistakes(!mistakes)} style={{ marginLeft: 'auto' }}>Mistakes only</button>}
      </div>
    </section>}

    {quiz.questions.map((q, i) => {
      const r = result?.results[i];
      if (mistakes && r?.correct) return null;
      return <fieldset className="card qcard" id={'q' + i} key={i}>
        <legend><span className="num">{String(i + 1).padStart(2, '0')}</span><span>{q.q}</span></legend>
        {q.options.map((o, j) => {
          const cls = r && (j === r.answer ? 'right' : answers[i] === j ? 'wrong' : '');
          return <label className={'choice ' + (cls || '')} key={j} aria-disabled={result ? true : undefined}>
            <input type="radio" name={'q' + i} disabled={!!result} checked={answers[i] === j}
              onChange={() => { setConfirm(false); setAnswers(a => { const b = [...a]; b[i] = j; return b; }); }} />
            <span className="key">{'ABCD'[j]}</span><span>{o}</span>
            {cls === 'right' && <span className="tag-r good">{answers[i] === j ? '✓ Your answer' : 'Correct answer'}</span>}
            {cls === 'wrong' && <span className="tag-r bad">✗ Your answer</span>}
          </label>;
        })}
        {r && <div className="explain" style={{ '--c': r.correct ? 'var(--good)' : 'var(--bad)' }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: r.correct ? 'var(--good)' : 'var(--bad)' }}>
            {r.correct ? 'Correct' : answers[i] == null ? 'Not answered' : 'Incorrect'} · Explanation
          </div>{r.explanation}
        </div>}
      </fieldset>;
    })}

    {!result && <div className="dock">
      <span className="num" style={{ fontSize: 14 }}>{answered}/{total}<span className="muted"> answered</span></span>
      <div className="meter" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <div style={{ width: `${100 * answered / total}%` }} />
      </div>
      <span className="num muted" style={{ fontSize: 14 }} aria-label="Time elapsed">{clock(secs)}</span>
      {confirm && <span role="alert" style={{ color: 'var(--warn)', fontSize: 14 }}>{total - answered} unanswered, counted as wrong.</span>}
      <button disabled={busy}>{busy ? 'Grading…' : confirm ? 'Submit anyway' : 'Submit answers'}</button>
      {err && <span role="alert" className="err" style={{ fontSize: 14, width: '100%' }}>{err}</span>}
    </div>}
  </form>;
}

const Spinner = () => <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 100" strokeLinecap="round">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
  </circle>
</svg>;
