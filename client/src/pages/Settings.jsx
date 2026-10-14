import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, cr, left, nameOf } from '../App.jsx';

const Section = ({ title, hint, children }) => <section className="card rise" style={{ padding: 22, display: 'grid', gap: 14 }}>
  <div><h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>{hint && <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{hint}</p>}</div>
  {children}
</section>;
const Row = ({ k, children }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 14, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
  <span className="muted">{k}</span><span style={{ textAlign: 'right' }}>{children}</span>
</div>;

// Theme: light / dark / system. "System" clears the saved choice so the OS setting applies.
function Appearance() {
  const [t, setT] = useState(() => { try { return localStorage.theme || 'system'; } catch { return 'system'; } });
  const pick = v => {
    setT(v);
    try { v === 'system' ? localStorage.removeItem('theme') : (localStorage.theme = v); } catch {}
    v === 'system' ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = v);
  };
  return <div className="seg" role="group" aria-label="Theme" style={{ justifySelf: 'start' }}>
    {['light', 'dark', 'system'].map(v => <button key={v} type="button" aria-pressed={t === v} onClick={() => pick(v)} style={{ textTransform: 'capitalize' }}>{v}</button>)}
  </div>;
}

const FIELDS = [
  ['name', 'Full name', 'text', 'e.g. Shrikant Rathod', 80],
  ['birthDate', 'Date of birth', 'date'],
  ['phone', 'Phone', 'tel', 'e.g. +91 98765 43210', 20],
  ['college', 'College / university', 'text', 'e.g. MIT World Peace University', 120],
  ['course', 'Course / branch', 'text', 'e.g. B.Tech Computer Engineering', 80],
  ['year', 'Year / semester', 'text', 'e.g. 4th year, Sem 7', 30],
];
const fmtDob = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// View the profile, or edit it in place. Saves through PUT /api/profile, which validates every field.
function Profile({ user, setUser }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = user.profile || {};
  const save = async e => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api('/profile', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      setUser(u => ({ ...u, profile: r.profile })); setEditing(false); setMsg({ text: 'Profile saved.' });
    } catch (x) { setMsg({ err: true, text: x.message }); }
    setBusy(false);
  };
  return <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span className="avatar" style={{ width: 52, height: 52, fontSize: 22 }} aria-hidden>{nameOf(user)[0].toUpperCase()}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || nameOf(user)}</strong>
        <span className="muted" style={{ fontSize: 13 }}>{user.email} · {{ pro: 'Pro plan', past_due: 'Pro · payment failed' }[user.plan] || 'Free plan'}</span>
      </div>
      {!editing && <button className="ghost" onClick={() => { setEditing(true); setMsg(null); }}>Edit profile</button>}
    </div>
    {editing
      ? <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {FIELDS.map(([k, label, type, ph, max]) => <label className="field" key={k}>{label}
              <input name={k} type={type} defaultValue={p[k] || ''} placeholder={ph} maxLength={max} autoComplete={{ name: 'name', birthDate: 'bday', phone: 'tel', college: 'organization' }[k] || 'off'}
                max={type === 'date' ? new Date().toISOString().slice(0, 10) : undefined} />
            </label>)}
            <label className="field">Email<input value={user.email} disabled title="Your email is your login and can't be changed here" /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
            <button type="button" className="ghost" onClick={() => { setEditing(false); setMsg(null); }}>Cancel</button>
            {msg && <span role="alert" className="err" style={{ fontSize: 14 }}>{msg.text}</span>}
          </div>
        </form>
      : <div>
          {FIELDS.map(([k, label]) => <Row key={k} k={label}>{p[k] ? (k === 'birthDate' ? fmtDob(p[k]) : p[k]) : <span className="muted">Not set</span>}</Row>)}
          {msg && <p role="status" className="good" style={{ fontSize: 14, margin: '10px 0 0' }}>{msg.text}</p>}
        </div>}
  </>;
}

export default function Settings({ user, setUser, refresh, logout }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const savePw = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('password') !== f.get('confirm')) return setMsg({ err: true, text: "The new passwords don't match." });
    setBusy(true); setMsg(null);
    try { await api('/password', { body: { current: f.get('current') || undefined, password: f.get('password') } }); e.target.reset(); setMsg({ text: 'Password saved. Other devices were logged out.' }); refresh(); }
    catch (x) { setMsg({ err: true, text: x.message }); }
    setBusy(false);
  };

  return <div style={{ display: 'grid', gap: 12 }}>
    <p className="eyebrow">Settings</p>
    <h2 style={{ marginBottom: 8 }}>Your <em>account</em></h2>

    <Section title="Profile" hint="Your name shows in the sidebar. Email is your login and can't be changed.">
      <Profile user={user} setUser={setUser} />
    </Section>

    <Section title="Account">
      <div>
        <Row k="Signed in with">{user.google ? 'Google' : 'Email and password'}{user.google && user.hasPassword && ' · password set'}</Row>
        <Row k="Member since">{user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</Row>
        <Row k="Credits"><span className="num">{cr(user.credits)}</span> · ≈ {left(user.credits)} question{left(user.credits) === 1 ? '' : 's'} left · <Link to="/wallet">Wallet →</Link></Row>
      </div>
    </Section>

    <Section title="Appearance" hint="System follows your device's light or dark setting."><Appearance /></Section>

    <Section title={user.hasPassword ? 'Change password' : 'Set a password'}
      hint={user.hasPassword ? 'Saving logs you out on every other device.' : 'You signed in with Google. Add a password to also log in with your email.'}>
      <form onSubmit={savePw} style={{ display: 'grid', gap: 12, maxWidth: 380 }}>
        {user.hasPassword && <label className="field">Current password<input name="current" type="password" autoComplete="current-password" required /></label>}
        <label className="field">New password<input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required placeholder="At least 8 characters" /></label>
        <label className="field">Confirm new password<input name="confirm" type="password" minLength={8} maxLength={72} autoComplete="new-password" required /></label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
          {msg && <span role={msg.err ? 'alert' : 'status'} className={msg.err ? 'err' : 'good'} style={{ fontSize: 14 }}>{msg.text}</span>}
        </div>
      </form>
    </Section>

    <Section title="Log out" hint="Log out of StudyMate on this device. Your notes, chats and credits stay saved.">
      <button className="ghost" onClick={logout} style={{ justifySelf: 'start' }}>Log out</button>
    </Section>
  </div>;
}
