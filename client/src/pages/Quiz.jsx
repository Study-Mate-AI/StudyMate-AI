import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useSubjects } from '../App.jsx';

export default function Quiz({ setCredits }) {
  const { id } = useParams();
  return id ? <TestRoom id={id} /> : <Generate setCredits={setCredits} />;
}

function Generate({ setCredits }) {
  const subjects = useSubjects();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const q = await api('/quiz', { body: Object.fromEntries(new FormData(e.target)) });
      setCredits(q.credits);
      nav('/quiz/' + q._id);
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  if (!subjects.length) return <p className="muted">Upload notes first — quizzes are built from them.</p>;

  return <>
    <h2>Generate a quiz</h2>
    <form className="card" onSubmit={submit}>
      <select name="subject" defaultValue={params.get('subject') || subjects[0]} aria-label="Subject">
        {subjects.map(s => <option key={s}>{s}</option>)}
      </select>
      <input name="topic" placeholder="Topic (e.g. Photosynthesis)" defaultValue={params.get('topic') || ''} required aria-label="Topic" />
      <select name="difficulty" defaultValue="Medium" aria-label="Difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <input name="n" type="number" min="1" max="15" defaultValue="5" style={{ width: 70 }} aria-label="Number of questions" />
      <button disabled={busy}>{busy ? 'Generating…' : 'Generate'}</button>
    </form>
    {err && <p className="err">{err}</p>}
  </>;
}

function TestRoom({ id }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/quiz/' + id).then(setQuiz, x => setErr(x.message)); }, [id]);

  const submit = e => {
    e.preventDefault();
    api(`/quiz/${id}/attempt`, { body: { answers } }).then(setResult, x => setErr(x.message));
  };

  if (err) return <p className="err">{err}</p>;
  if (!quiz) return <p className="muted">Loading…</p>;

  return <form onSubmit={submit} style={{ display: 'block' }}>
    <h2>{quiz.topic} <span className="muted">· {quiz.subject} · {quiz.difficulty}</span></h2>
    {result && <p className="card"><strong>Score: {result.score}/{result.total}</strong> ({Math.round(100 * result.score / result.total)}%)</p>}
    {quiz.questions.map((q, i) => {
      const r = result?.results[i];
      return <fieldset className="card" key={i} style={{ border: '1px solid var(--line)' }}>
        <legend><strong>{i + 1}. {q.q}</strong></legend>
        {q.options.map((o, j) => <label className="opt" key={j}
          style={r && j === r.answer ? { color: 'var(--good)', fontWeight: 600 } : r && answers[i] === j ? { color: 'var(--bad)' } : undefined}>
          <input type="radio" name={'q' + i} required disabled={!!result} checked={answers[i] === j}
            onChange={() => setAnswers(a => { const b = [...a]; b[i] = j; return b; })} /> {o}
        </label>)}
        {r && <p className={r.correct ? 'good' : 'bad'}>{r.correct ? '✓ Correct' : '✗ Incorrect'} — <span style={{ color: 'var(--fg)' }}>{r.explanation}</span></p>}
      </fieldset>;
    })}
    {!result && <button>Submit answers</button>}
  </form>;
}
