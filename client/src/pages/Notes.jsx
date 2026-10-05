import { useEffect, useRef, useState } from 'react';
import { api } from '../App.jsx';

const css = `
.drop { display: grid; place-items: center; gap: 4px; text-align: center; padding: 30px 20px; border: 1.5px dashed var(--line-2); border-radius: 10px; cursor: pointer;
  transition: border-color .2s, background .2s; }
.drop:hover, .drop.over { border-color: var(--accent); background: var(--accent-soft); }
.drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.drop:focus-within { border-color: var(--accent); }
.pdf-icon { width: 34px; height: 42px; border-radius: 4px; border: 1.5px solid var(--ink-3); position: relative; margin-bottom: 8px;
  font: 600 8px/1 var(--mono); color: var(--ink-3); display: grid; place-items: end center; padding-bottom: 6px; }
.pdf-icon::after { content: ''; position: absolute; top: -1.5px; right: -1.5px; width: 10px; height: 10px; background: var(--surface); border-left: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3); border-bottom-left-radius: 3px; }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.note { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 16px 16px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  border-top: 3px solid var(--c); transition: transform .2s var(--ease), box-shadow .2s; }
.note:hover { transform: translateY(-2px); box-shadow: 0 10px 24px -14px rgb(0 0 0 / .25); }
.note h3 { margin: 0; font-size: 16px; }
.note .excerpt { margin: 0; font-size: 13px; line-height: 20px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.note footer { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-3); }
.note footer button { padding: 4px 9px; font-size: 12px; }
.tag { font: 500 10px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--line-2); color: var(--ink-2); }
.danger { background: var(--bad); border-color: var(--bad); color: #fff; }
.group-head { display: flex; align-items: center; gap: 10px; margin: 32px 0 12px; }
.group-head h3 { margin: 0; font-size: 15px; }
`;

// A fixed, harmonious set of hues, handed out in alphabetical subject order so neighbours never clash.
const HUES = [150, 25, 250, 75, 330, 195, 285, 50];
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(d) {
  const s = (new Date(d) - Date.now()) / 1000;
  for (const [u, n] of [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export default function Notes() {
  const [notes, setNotes] = useState(null);
  const [kind, setKind] = useState('pdf');
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const form = useRef();
  const load = () => api('/notes').then(setNotes);
  useEffect(() => { load(); }, []);

  const subjects = Object.entries(Object.groupBy(notes ?? [], n => n.subject)).sort(([a], [b]) => a.localeCompare(b));
  const hue = s => HUES[subjects.findIndex(([x]) => x === s) % HUES.length];
  const shown = filter ? subjects.filter(([s]) => s === filter) : subjects;
  const pages = notes?.reduce((t, n) => t + (n.pages || 0), 0) ?? 0;

  const pick = f => {
    if (!f) return;
    if (f.type !== 'application/pdf') return setErr('That file isn\'t a PDF.');
    setErr(''); setFile(f);
    const title = form.current.elements.title;
    if (!title.value) title.value = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  };

  const upload = async e => {
    e.preventDefault();
    const data = new FormData(e.target);
    data.delete('file');
    if (kind === 'pdf') { if (!file) return setErr('Choose a PDF to upload.'); data.set('file', file); data.delete('text'); }
    else if (!data.get('text').trim()) return setErr('Paste some notes first.');
    setBusy(true); setErr('');
    try { await api('/notes', { form: data }); e.target.reset(); setFile(null); await load(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const del = async id => { await api('/notes/' + id, { method: 'DELETE' }); setConfirming(null); load(); };

  return <>
    <style>{css}</style>
    <p className="eyebrow">Notes</p>
    <h2 style={{ marginBottom: 6 }}>Your <em>library</em></h2>
    <p className="muted" style={{ margin: '0 0 24px' }}>
      {notes?.length ? <>{plural(notes.length, 'note')} across {plural(subjects.length, 'subject')}{pages > 0 && ` · ${plural(pages, 'page')} read`}</>
        : 'Add lecture slides, textbook chapters or your own notes. The tutor and quizzes only use what you put here.'}
    </p>

    <form ref={form} className="card rise" onSubmit={upload} style={{ display: 'grid', gap: 14, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>Add notes</strong>
        <div className="seg" role="group" aria-label="Note type" style={{ marginLeft: 'auto' }}>
          <button type="button" aria-pressed={kind === 'pdf'} onClick={() => { setKind('pdf'); setErr(''); }}>PDF</button>
          <button type="button" aria-pressed={kind === 'text'} onClick={() => { setKind('text'); setErr(''); }}>Text</button>
        </div>
      </div>

      {kind === 'pdf'
        ? <label className={'drop' + (over ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
            <input name="file" type="file" accept="application/pdf" onChange={e => pick(e.target.files[0])} aria-label="PDF file" />
            <span className="pdf-icon" aria-hidden>PDF</span>
            {file
              ? <><strong>{file.name}</strong><span className="muted" style={{ fontSize: 13 }}>{(file.size / 1048576).toFixed(1)} MB · click to choose a different file</span></>
              : <><strong>Drop a PDF here, or click to browse</strong><span className="muted" style={{ fontSize: 13 }}>Text is pulled from every page. Up to 10 MB.</span></>}
          </label>
        : <textarea name="text" className="ruled" placeholder="Paste or type your notes…" aria-label="Text notes"
            style={{ minHeight: 170, lineHeight: '28px', padding: '0 14px', resize: 'vertical' }} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="field">Title<input name="title" placeholder="e.g. Lecture 4: Cell respiration" required maxLength={200} /></label>
        <label className="field">Subject
          <input name="subject" placeholder="e.g. Biology" required maxLength={80} list="subjects" />
          <datalist id="subjects">{subjects.map(([s]) => <option key={s} value={s} />)}</datalist>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button disabled={busy}>{busy ? 'Reading and indexing…' : 'Add to library'}</button>
        {err ? <span role="alert" className="err" style={{ fontSize: 14 }}>{err}</span>
          : <span className="muted" style={{ fontSize: 13 }}>Indexing is free and doesn't use tokens.</span>}
      </div>
    </form>

    {notes && !notes.length && <div className="card ruled" style={{ textAlign: 'center', padding: '56px 20px', marginTop: 24, lineHeight: '28px' }}>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: '-6px 0 0' }}>Your shelf is empty.</p>
      <p className="muted" style={{ margin: '6px 0 0' }}>Add your first PDF or paste some notes above.</p>
    </div>}

    {subjects.length > 1 && <div role="group" aria-label="Filter by subject" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 32 }}>
      <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>All</button>
      {subjects.map(([s, ns]) => <button key={s} className="chip tint" style={{ '--h': hue(s) }} aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)}>
        <span className="dot" />{s}<span className="num" style={{ opacity: .6 }}>{ns.length}</span>
      </button>)}
    </div>}

    {shown.map(([subject, ns]) => <section key={subject} className="tint" style={{ '--h': hue(subject) }} aria-label={subject}>
      <div className="group-head">
        <span className="dot" style={{ width: 10, height: 10 }} />
        <h3>{subject}</h3>
        <span className="muted num" style={{ fontSize: 13 }}>{plural(ns.length, 'note')}</span>
      </div>
      <div className="shelf">
        {ns.map(n => <article className="note rise" key={n._id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
            <h3 style={{ flex: 1 }}>{n.title}</h3>
            <span className="tag">{n.source || 'note'}</span>
          </div>
          {n.excerpt && <p className="excerpt">{n.excerpt}{n.excerpt.length >= 220 && '…'}</p>}
          <footer>
            {confirming === n._id
              ? <><span style={{ color: 'var(--bad)', marginRight: 'auto' }}>Delete this note?</span>
                  <button className="ghost" onClick={() => setConfirming(null)}>Cancel</button>
                  <button className="danger" onClick={() => del(n._id)}>Delete</button></>
              : <><span>{n.pages ? plural(n.pages, 'page') : plural(n.chunks, 'section')}</span>
                  <span>·</span><span title={new Date(n.at).toLocaleString()}>{ago(n.at)}</span>
                  <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => setConfirming(n._id)} aria-label={`Delete ${n.title}`}>Delete</button></>}
          </footer>
        </article>)}
      </div>
    </section>)}
  </>;
}
