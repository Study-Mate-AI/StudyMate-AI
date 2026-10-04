import { useEffect, useState } from 'react';
import { api } from '../App.jsx';

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => api('/notes').then(setNotes);
  useEffect(() => { load(); }, []);

  const upload = async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    if (!form.get('file')?.size) form.delete('file');
    setBusy(true); setErr('');
    try { await api('/notes', { form }); e.target.reset(); load(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const del = id => confirm('Delete this note?') && api('/notes/' + id, { method: 'DELETE' }).then(load);

  return <>
    <h2>Your notes</h2>
    <form className="card" onSubmit={upload}>
      <input name="title" placeholder="Title" required aria-label="Title" />
      <input name="subject" placeholder="Subject (e.g. Biology)" required list="subjects" aria-label="Subject" />
      <datalist id="subjects">{[...new Set(notes.map(n => n.subject))].map(s => <option key={s} value={s} />)}</datalist>
      <input name="file" type="file" accept="application/pdf" aria-label="PDF file" />
      <textarea name="text" placeholder="…or paste text notes here" aria-label="Text notes" />
      <button disabled={busy}>{busy ? 'Indexing…' : 'Upload'}</button>
      {err && <span className="err">{err}</span>}
    </form>
    {!notes.length && <p className="muted">No notes yet. Upload a PDF or paste text to start.</p>}
    {notes.map(n => <div className="card" key={n._id} style={{ display: 'flex', alignItems: 'center' }}>
      <div><strong>{n.title}</strong> <span className="muted">· {n.subject} · {n.chunks} chunks</span></div>
      <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => del(n._id)}>Delete</button>
    </div>)}
  </>;
}
