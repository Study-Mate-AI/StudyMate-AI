import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Notes from './pages/Notes.jsx';
import Chat from './pages/Chat.jsx';
import Quiz from './pages/Quiz.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Wallet from './pages/Wallet.jsx';
import Settings from './pages/Settings.jsx';

// Balances are stored in tokens; everything users see is credits. 1 credit = 100 tokens.
export const cr = t => (Math.round((t || 0) / 10) / 10).toLocaleString();
// Typical cost of one query in tokens, used for "≈ N questions left" until the user has their own average.
export const AVG = { chat: 300, quiz: 900 };
export const left = (balance, avg = AVG.chat) => Math.floor((balance || 0) / Math.max(avg, 1));
// The name the user set in Settings → Profile, else the part of the email before @.
// First name for the sidebar (from Settings → Profile / signup), else the part of the email before @.
export const nameOf = u => u.profile?.name?.split(' ')[0] || u.email.split('@')[0];
export const LOW = 300; // tokens (3 credits ≈ 1 question): show the low-balance warning below this

// A fixed, harmonious set of hues, handed out in alphabetical subject order so neighbours never clash.
export const HUES = [150, 25, 250, 75, 330, 195, 285, 50];
export const hueOf = (subjects, s) => HUES[[...subjects].sort((a, b) => a.localeCompare(b)).indexOf(s) % HUES.length];
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(d) {
  const s = (new Date(d) - Date.now()) / 1000;
  for (const [u, n] of [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}

export async function api(path, { body, method, form } = {}) {
  const res = await fetch('/api' + path, {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 402) window.dispatchEvent(new Event('credits:empty'));
  // No JSON error on a 5xx = the dev proxy couldn't reach the API server.
  if (!res.ok) throw Object.assign(new Error(data.error || (res.status >= 500 ? "Can't reach the server. Is the API server running?" : 'Request failed')), { status: res.status });
  return data;
}

// Eases a displayed number toward its target so balance changes read as motion, not a jump.
export function useTween(target, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(target);
    const start = performance.now(), a = from.current;
    let raf;
    const step = t => {
      const p = Math.min(1, (t - start) / ms), e = 1 - (1 - p) ** 3;
      setV(Math.round(a + (target - a) * e));
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return v;
}

// Overrides the system colour scheme; the choice is remembered (applied before paint in index.html).
export function ThemeToggle({ style }) {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
  const flip = () => {
    const t = dark ? 'light' : 'dark';
    const apply = () => { document.documentElement.dataset.theme = t; setDark(!dark); };
    document.startViewTransition ? document.startViewTransition(apply) : apply();
    try { localStorage.theme = t; } catch {}
  };
  return <button type="button" className="ghost theme-toggle" onClick={flip} style={style}
    aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      {dark
        ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
        : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />}
    </svg>
  </button>;
}

const sbCss = `
.shell { --sbw: 252px; min-height: 100dvh; }
.shell.collapsed { --sbw: 68px; }
.sb { position: fixed; inset: 0 auto 0 0; z-index: 20; width: var(--sbw); display: flex; flex-direction: column; gap: 4px; padding: 12px 10px;
  background: color-mix(in srgb, var(--surface) 70%, var(--paper)); border-right: 1px solid var(--line); transition: width .25s var(--ease), transform .25s var(--ease); overflow: hidden; }
.sb-top { display: flex; align-items: center; gap: 8px; padding: 2px 4px 12px; min-height: 44px; }
.sb-brand { font-family: var(--serif); font-size: 22px; white-space: nowrap; color: var(--ink); text-decoration: none; flex: 1; }
.sb-icon { flex: none; width: 36px; height: 36px; padding: 0; display: grid; place-items: center; background: transparent; color: var(--ink-2); border: 0; border-radius: 9px; }
.sb-icon:hover { background: var(--line); color: var(--ink); }
.sb a.item, .sb button.item { display: flex; align-items: center; gap: 12px; padding: 9px 11px; border-radius: 9px; color: var(--ink-2); text-decoration: none; white-space: nowrap;
  background: transparent; border: 0; font: inherit; font-size: 14.5px; font-weight: 500; width: 100%; justify-content: flex-start; transition: background .15s, color .15s; }
.sb .item svg { flex: none; }
.sb .item:hover { background: var(--line); color: var(--ink); }
.sb a.item.active { background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-2); }
.sb .label { overflow: hidden; text-overflow: ellipsis; transition: opacity .2s; }
.collapsed .sb .label, .collapsed .sb-brand, .collapsed .sb-credit .detail { opacity: 0; pointer-events: none; }
.collapsed .sb-top { flex-direction: column; gap: 4px; }
.collapsed .sb-brand { display: none; }
.sb-sep { height: 1px; background: var(--line); margin: 8px 4px; }
.sb-credit { display: flex; align-items: center; gap: 12px; padding: 10px 11px; border-radius: 10px; text-decoration: none; color: var(--ink); border: 1px solid var(--line); background: var(--surface); white-space: nowrap; }
.sb-credit:hover { border-color: var(--line-2); }
.sb-credit .detail { display: grid; line-height: 1.25; min-width: 0; }
.sb-user { display: flex; align-items: center; gap: 10px; padding: 8px 6px; white-space: nowrap; }
.avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; }
.sb-user .who { min-width: 0; display: grid; line-height: 1.25; font-size: 13px; }
.sb-user .who b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.page { margin-left: var(--sbw); transition: margin-left .25s var(--ease); }
.topbar { display: none; }
.scrim { display: none; }
.alert-bar { padding: 10px 20px; text-align: center; border-bottom: 1px solid var(--line); display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap; }
.alert-bar button { padding: 3px 9px; font-size: 12px; background: transparent; color: inherit; border-color: currentColor; }
@media (max-width: 760px) {
  .shell, .shell.collapsed { --sbw: 0px; }
  .sb { width: 264px; transform: translateX(-100%); box-shadow: 0 0 40px rgb(0 0 0 / .3); }
  .shell.open .sb { transform: none; }
  .shell.open .scrim { display: block; position: fixed; inset: 0; z-index: 15; background: rgb(0 0 0 / .35); }
  .collapsed .sb .label, .collapsed .sb-brand, .collapsed .sb-credit .detail { opacity: 1; pointer-events: auto; }
  .collapsed .sb-brand { display: block; } .collapsed .sb-top { flex-direction: row; }
  .sb .collapse-btn { display: none; }
  .topbar { display: flex; position: sticky; top: 0; z-index: 10; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 85%, transparent); backdrop-filter: blur(12px); }
}
`;

// Small stroke icons for the sidebar (24×24 paths).
const I = {
  notes: 'M5 3h10l4 4v14H5z M15 3v4h4 M8 12h8 M8 16h6', tutor: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5', quiz: 'M9 11l2 2 4-4 M4 4h16v16H4z',
  progress: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2', wallet: 'M3 7h18v13H3z M3 7l3-4h12l3 4 M16 13h2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  panel: 'M3 4h18v16H3z M9 4v16', menu: 'M4 6h16 M4 12h16 M4 18h16',
};
export const Ico = ({ d, size = 19 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

function CreditMeter({ credits }) {
  const shown = useTween(credits);
  const state = credits <= 0 ? 'var(--bad)' : credits < LOW ? 'var(--warn)' : 'var(--good)';
  return <Link to="/wallet" viewTransition className="sb-credit" title={`${cr(credits)} credits · about ${left(credits)} questions left`}>
    <span aria-hidden style={{ flex: 'none', width: 9, height: 9, margin: '0 5px', borderRadius: 9, background: state, boxShadow: `0 0 0 3px color-mix(in srgb, ${state} 20%, transparent)` }} />
    <span className="detail">
      <span><span className="num" style={{ fontWeight: 600 }}>{cr(shown)}</span> <span className="muted" style={{ fontSize: 13 }}>credits</span></span>
      <span className="muted" style={{ fontSize: 12 }}>≈ {left(credits)} question{left(credits) === 1 ? '' : 's'} left</span>
    </span>
  </Link>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [empty, setEmpty] = useState(false);
  const [low, setLow] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.sidebar === 'collapsed'; } catch { return false; } });
  const [open, setOpen] = useState(false); // phone drawer
  const navigate = useNavigate();
  const toggle = () => setCollapsed(c => { try { localStorage.sidebar = c ? 'open' : 'collapsed'; } catch {} return !c; });
  const refresh = () => api('/me').then(setUser, () => setUser(null));
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const on = () => { setEmpty(true); setLow(false); setUser(u => u && { ...u, credits: 0 }); };
    window.addEventListener('credits:empty', on);
    return () => window.removeEventListener('credits:empty', on);
  }, []);

  if (user === undefined) return null;
  if (!user) return <Routes>
    <Route path="/" element={<Landing onLogin={setUser} />} />
    <Route path="*" element={<Login onLogin={setUser} />} />
  </Routes>;

  // The request that used the last credits is always finished and shown; the warning comes after it.
  const setCredits = credits => {
    if (credits == null) return;
    setUser(u => ({ ...u, credits }));
    setEmpty(credits <= 0);
    setLow(credits > 0 && credits < LOW);
  };
  const logout = () => api('/logout', { method: 'POST' }).finally(() => { setUser(null); setEmpty(false); setLow(false); navigate('/', { replace: true }); });
  const props = { user, setCredits, refresh, setUser };
  const item = (to, icon, label) => <NavLink to={to} viewTransition className="item" title={collapsed ? label : undefined} onClick={() => setOpen(false)}>
    <Ico d={I[icon]} /><span className="label">{label}</span>
  </NavLink>;

  return <div className={'shell' + (collapsed ? ' collapsed' : '') + (open ? ' open' : '')}>
    <style>{sbCss}</style>
    <aside className="sb" aria-label="Main navigation">
      <div className="sb-top">
        <Link to="/notes" className="sb-brand" onClick={() => setOpen(false)}>StudyMate</Link>
        <button className="sb-icon collapse-btn" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Ico d={I.panel} />
        </button>
      </div>
      {item('/notes', 'notes', 'Notes')}{item('/chat', 'tutor', 'Tutor')}{item('/quiz', 'quiz', 'Quiz')}
      {item('/dashboard', 'progress', 'Progress')}{item('/wallet', 'wallet', 'Wallet')}
      <div style={{ flex: 1 }} />
      <CreditMeter credits={user.credits} />
      <div className="sb-sep" />
      {item('/settings', 'settings', 'Settings')}
      <Link to="/settings" className="sb-user" title={`${nameOf(user)} · ${user.email}`} onClick={() => setOpen(false)} style={{ textDecoration: 'none', color: 'inherit', borderRadius: 9 }}>
        <span className="avatar" aria-hidden>{nameOf(user)[0].toUpperCase()}</span>
        <span className="who label"><b>{nameOf(user)}</b><span className="muted">{{ pro: 'Pro plan', past_due: 'Pro · payment failed' }[user.plan] || 'Free plan'}</span></span>
      </Link>
    </aside>
    <div className="scrim" onClick={() => setOpen(false)} />

    <div className="page">
      <div className="topbar">
        <button className="sb-icon" onClick={() => setOpen(true)} aria-label="Open menu"><Ico d={I.menu} /></button>
        <span className="sb-brand">StudyMate</span>
        <Link to="/wallet" className="muted" style={{ fontSize: 13, textDecoration: 'none' }}><span className="num" style={{ color: 'var(--ink)' }}>{cr(user.credits)}</span> credits</Link>
      </div>
      {empty && <div role="alert" className="alert-bar rise" style={{ background: 'var(--warn-soft)', color: 'var(--bad)' }}>
        <span>You've used all your credits. Your last request was completed; new questions and quizzes need a top-up.</span>
        <Link to="/wallet" viewTransition style={{ color: 'inherit', fontWeight: 600 }}>Recharge →</Link>
      </div>}
      {low && <div role="status" className="alert-bar rise" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
        <span>Running low: {cr(user.credits)} credits left, about {left(user.credits)} more question{left(user.credits) === 1 ? '' : 's'}.</span>
        <Link to="/wallet" viewTransition style={{ color: 'inherit', fontWeight: 600 }}>Top up</Link>
        <button onClick={() => setLow(false)}>Dismiss</button>
      </div>}
      <main>
      <Routes>
        <Route path="/notes" element={<Notes {...props} />} />
        <Route path="/chat" element={<Chat {...props} />} />
        <Route path="/quiz" element={<Quiz {...props} />} />
        <Route path="/quiz/:id" element={<Quiz {...props} />} />
        <Route path="/dashboard" element={<Dashboard {...props} />} />
        <Route path="/wallet" element={<Wallet {...props} />} />
        <Route path="/settings" element={<Settings {...props} logout={logout} />} />
        <Route path="*" element={<Navigate to="/notes" />} />
      </Routes>
      </main>
    </div>
  </div>;
}

// Google's own "Sign in with Google" button. Google renders it; the ID token goes to the server to verify.
export function GoogleButton({ onLogin }) {
  const ref = useRef();
  const [err, setErr] = useState('');
  useEffect(() => {
    const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!id) return;
    const init = () => {
      google.accounts.id.initialize({ client_id: id, callback: ({ credential }) => api('/google', { body: { credential } }).then(onLogin, e => setErr(e.message)) });
      google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
    };
    if (window.google?.accounts) return init();
    const s = document.querySelector('script[src*="gsi/client"]');
    s?.addEventListener('load', init);
    return () => s?.removeEventListener('load', init);
  }, []);
  return <div><div ref={ref} style={{ minHeight: 44 }} />{err && <p role="alert" className="err" style={{ fontSize: 13, margin: '6px 0 0' }}>{err}</p>}</div>;
}

// Subjects come from the notes list; shared by Chat and Quiz.
export function useSubjects() {
  const [subjects, setSubjects] = useState([]);
  useEffect(() => { api('/notes').then(n => setSubjects([...new Set(n.map(x => x.subject))])); }, []);
  return subjects;
}
