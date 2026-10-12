import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useSubjects, hueOf } from '../App.jsx';

const css = `
.thread { display: grid; gap: 14px; margin: 24px 0 8px; }
.bubble-me { justify-self: end; max-width: min(80%, 560px); background: var(--ink); color: var(--paper); padding: 10px 14px; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; }
.bubble-ai { background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 14px 18px; max-width: 100%; }
.bubble-ai .ans p { margin: 0 0 10px; } .bubble-ai .ans p:last-child { margin-bottom: 0; }
.bubble-ai .ans ul, .bubble-ai .ans ol { margin: 0 0 10px; padding-left: 22px; } .bubble-ai .ans li { margin: 3px 0; }
.bubble-ai code { font: 13px var(--mono); background: var(--line); padding: 1px 5px; border-radius: 4px; }
.cite { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; margin: 0 1px; vertical-align: 2px; border-radius: 5px;
  font: 600 10.5px/1 var(--mono); background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); cursor: pointer; }
.cite:hover, .cite[aria-expanded="true"] { background: var(--accent); color: var(--accent-ink); }
.srcs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.src { background: transparent; color: var(--ink-2); border: 1px solid var(--line-2); padding: 4px 9px 4px 4px; border-radius: 7px; font-size: 12.5px; font-weight: 500; gap: 7px; max-width: 100%; }
.src .n { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; font: 600 10.5px/1 var(--mono); background: var(--line); color: var(--ink-2); flex: none; }
.src.used { color: var(--ink); } .src.used .n { background: var(--accent-soft); color: var(--accent); }
.src:not(.used) { opacity: .65; }
.src[aria-expanded="true"] { border-color: var(--accent); opacity: 1; }
.src span.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.excerpt-box { margin-top: 10px; padding: 12px 14px; border-radius: 8px; background: var(--paper); border-left: 3px solid var(--accent); font-size: 13.5px; color: var(--ink-2);
  max-height: 220px; overflow: auto; white-space: pre-wrap; }
.composer { position: sticky; bottom: 12px; z-index: 4; display: flex; gap: 8px; align-items: end; padding: 8px; margin-top: 12px; border: 1px solid var(--line-2); border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 12px 30px -18px rgb(0 0 0 / .4); }
.composer textarea { flex: 1; min-height: 0; border: 0; resize: none; field-sizing: content; max-height: 180px; background: transparent; padding: 8px 10px; }
.composer textarea:focus-visible { box-shadow: none; }
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 12px 30px -18px rgb(0 0 0 / .4); }
.starters { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 16px; }
.starters button { justify-content: flex-start; text-align: left; background: var(--surface); color: var(--ink-2); border-color: var(--line-2); font-weight: 400; }
.starters button:hover { color: var(--ink); border-color: var(--accent); }
.typing span { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: var(--ink-3); animation: blink 1.2s infinite both; }
.typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
`;

const starters = s => [`Summarise the key ideas in my ${s} notes`, 'What are the most important definitions?', 'Explain the hardest concept simply', 'What should I revise before the exam?'];
const where = s => s.page ? `${s.noteTitle} · p. ${s.page}${s.pageTo > s.page ? `–${s.pageTo}` : ''}` : s.noteTitle;

export default function Chat({ setCredits }) {
  const subjects = useSubjects();
  const [params, setParams] = useSearchParams();
  const subject = subjects.includes(params.get('subject')) ? params.get('subject') : subjects[0];
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // "message:source" whose excerpt is showing
  const [clearing, setClearing] = useState(false);
  const [more, setMore] = useState(null); // message whose unused sources are expanded
  const end = useRef();
  const box = useRef();

  useEffect(() => {
    if (!subject) return;
    setMessages(null); setOpen(null); setClearing(false); setErr('');
    api('/chat/' + encodeURIComponent(subject)).then(setMessages, x => { setErr(x.message); setMessages([]); });
  }, [subject]);
  useEffect(() => { if (messages?.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages?.length, busy]);

  const send = async q => {
    q = q.trim();
    if (!q || busy) return;
    setBusy(true); setErr(''); setDraft('');
    setMessages(m => [...m, { role: 'user', content: q }]);
    try {
      const r = await api('/chat', { body: { subject, question: q } });
      setMessages(m => [...m, { role: 'assistant', content: r.answer, sources: r.sources, tokens: r.tokens }]);
      setCredits(r.credits);
    } catch (x) {
      setErr(x.message); setDraft(q); setMessages(m => m.slice(0, -1)); // put the question back so it can be resent
    }
    setBusy(false);
    box.current?.focus();
  };
  const clear = async () => { await api('/chat/' + encodeURIComponent(subject), { method: 'DELETE' }); setMessages([]); setClearing(false); };
  const toggle = key => setOpen(o => o === key ? null : key);

  if (!subjects.length) return <>
    <p className="eyebrow">Tutor</p>
    <h2>Ask your <em>notes</em></h2>
    <div className="card ruled" style={{ textAlign: 'center', padding: '56px 20px', lineHeight: '28px' }}>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '-6px 0 0' }}>Nothing to read yet.</p>
      <p className="muted" style={{ margin: '6px 0 14px' }}>The tutor only answers from notes you've uploaded.</p>
      <Link className="btn" to="/notes" viewTransition>Upload notes</Link>
    </div>
  </>;

  return <>
    <style>{css}</style>
    <div style={{ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1 }}>
        <p className="eyebrow">Tutor</p>
        <h2 style={{ marginBottom: 0 }}>Ask your <em>notes</em></h2>
      </div>
      {messages?.length > 0 && (clearing
        ? <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>Clear this chat?
            <button className="ghost" onClick={() => setClearing(false)} style={{ padding: '5px 10px' }}>Cancel</button>
            <button onClick={clear} style={{ padding: '5px 10px', background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' }}>Clear</button></span>
        : <button className="ghost" onClick={() => setClearing(true)} disabled={busy} style={{ padding: '6px 11px', fontSize: 13 }}>Clear chat</button>)}
    </div>

    <div role="group" aria-label="Subject" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 18 }}>
      {subjects.map(s => <button key={s} className="chip tint" style={{ '--h': hueOf(subjects, s) }} aria-pressed={s === subject} disabled={busy}
        onClick={() => setParams({ subject: s }, { replace: true })}><span className="dot" />{s}</button>)}
    </div>

    {messages === null ? <p className="muted">Loading…</p> : <div className="thread" aria-live="polite">
      {!messages.length && <div className="card rise" style={{ padding: 22 }}>
        <strong>Ask anything about your {subject} notes.</strong>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Answers come only from what you've uploaded. Each fact is linked to the note it came from, so you can check it.</p>
        <div className="starters">{starters(subject).map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
      </div>}

      {messages.map((m, i) => m.role === 'user'
        ? <div className="bubble-me" key={i}>{m.content}</div>
        : <div className="bubble-ai rise" key={i}>
            <div className="ans"><Answer text={m.content} sources={m.sources} openKey={open} msg={i} onCite={n => toggle(`${i}:${n}`)} /></div>
            {m.sources?.length > 0 && <div className="srcs">
              {m.sources.map((s, j) => (s.cited !== false || more === i) && <button key={j} className={'src' + (s.cited !== false ? ' used' : '')} aria-expanded={open === `${i}:${j + 1}`}
                onClick={() => toggle(`${i}:${j + 1}`)} title={s.cited === false ? 'Retrieved but not used in this answer' : where(s)}>
                <span className="n">{j + 1}</span><span className="t">{where(s)}</span>
              </button>)}
              {more !== i && m.sources.some(s => s.cited === false) && <button className="src" onClick={() => setMore(i)} style={{ paddingLeft: 9 }}
                title="Notes the search found but the answer didn't use">+{m.sources.filter(s => s.cited === false).length} more</button>}
              {m.tokens > 0 && <span className="muted num" style={{ marginLeft: 'auto', fontSize: 12, alignSelf: 'center' }}>{m.tokens.toLocaleString()} tokens</span>}
            </div>}
            {m.sources?.map((s, j) => open === `${i}:${j + 1}` && <div className="excerpt-box" key={j}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Source {j + 1} · {where(s)}</div>{s.text}
            </div>)}
          </div>)}

      {busy && <div className="bubble-ai" aria-label="Tutor is answering">
        <span className="typing"><span /><span /><span /></span><span className="muted" style={{ fontSize: 13 }}>Reading your notes…</span>
      </div>}
      <div ref={end} />
    </div>}

    {err && <p role="alert" className="err" style={{ fontSize: 14 }}>{err}</p>}
    <form className="composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
      <textarea ref={box} rows={1} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} aria-label="Question"
        placeholder={`Ask about ${subject}…`} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }} />
      <button disabled={busy || !draft.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
    </form>
    <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: '8px 0 0' }}>Enter to send · Shift+Enter for a new line · uses tokens only when your notes have an answer</p>
  </>;
}

// ponytail: tiny Markdown subset (paragraphs, - / 1. lists, **bold**, `code`, [Source n]); swap in a parser if answers need tables
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
function Answer({ text, sources = [], openKey, msg, onCite }) {
  const blocks = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const l = raw.replace(/^#+\s+/, ''), b = l.match(BULLET);
    const kind = !l.trim() ? null : b ? (/\d/.test(b[0]) ? 'ol' : 'ul') : 'p';
    if (!kind) { cur = null; continue; }
    if (cur?.kind !== kind) blocks.push(cur = { kind, lines: [] });
    cur.lines.push(b ? l.slice(b[0].length) : l);
  }
  const inline = s => s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[Sources? [^\]]*\])/).map((part, k) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={k}>{part.slice(1, -1)}</code>;
    if (/^\[Sources? /.test(part)) return <Fragment key={k}>{(part.match(/\d+/g) ?? []).map(n => sources[n - 1]
      ? <button type="button" key={n} className="cite" aria-expanded={openKey === `${msg}:${n}`} onClick={() => onCite(Number(n))} aria-label={`Source ${n}: ${where(sources[n - 1])}`}>{n}</button>
      : null)}</Fragment>;
    return part;
  });
  return blocks.map((b, i) => b.kind === 'p'
    ? <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
    : <b.kind key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l)}</li>)}</b.kind>);
}
