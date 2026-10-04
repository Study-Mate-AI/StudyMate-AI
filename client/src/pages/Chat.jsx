import { useEffect, useState } from 'react';
import { api, useSubjects } from '../App.jsx';

export default function Chat({ setCredits }) {
  const subjects = useSubjects();
  const [subject, setSubject] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!subject && subjects[0]) setSubject(subjects[0]); }, [subjects]);
  useEffect(() => { if (subject) api('/chat/' + encodeURIComponent(subject)).then(setMessages); }, [subject]);

  const ask = async e => {
    e.preventDefault();
    const question = new FormData(e.target).get('q');
    setBusy(true); setErr('');
    setMessages(m => [...m, { role: 'user', content: question }]);
    try {
      const r = await api('/chat', { body: { subject, question } });
      setMessages(m => [...m, { role: 'assistant', content: r.answer, sources: r.sources }]);
      setCredits(r.credits);
      e.target.reset();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  if (!subjects.length) return <p className="muted">Upload some notes first — the tutor only answers from them.</p>;

  return <>
    <h2>AI Tutor</h2>
    <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject">
      {subjects.map(s => <option key={s}>{s}</option>)}
    </select>
    <div style={{ margin: '16px 0' }}>
      {messages.map((m, i) => <div className="card" key={i} style={m.role === 'user' ? { borderColor: 'var(--accent)' } : undefined}>
        <div className="msg">{m.content}</div>
        {m.sources?.map((s, j) => <details key={j}>
          <summary>[Source {j + 1}] {s.noteTitle}</summary>
          <p className="muted msg">{s.text}</p>
        </details>)}
      </div>)}
    </div>
    <form onSubmit={ask}>
      <input name="q" placeholder={`Ask about ${subject}…`} required style={{ flex: 1 }} aria-label="Question" />
      <button disabled={busy}>{busy ? 'Thinking…' : 'Ask'}</button>
    </form>
    {err && <p className="err">{err}</p>}
  </>;
}
