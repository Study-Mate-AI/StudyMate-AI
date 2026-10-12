import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Notes from './pages/Notes.jsx';
import Chat from './pages/Chat.jsx';
import Quiz from './pages/Quiz.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Wallet from './pages/Wallet.jsx';

export const LOW = 1000;

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

function CreditMeter({ credits }) {
  const shown = useTween(credits);
  const state = credits <= 0 ? 'var(--bad)' : credits < LOW ? 'var(--warn)' : 'var(--good)';
  return <Link to="/wallet" viewTransition className="btn ghost" title="Token wallet" style={{ padding: '6px 12px' }}>
    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 9, background: state, boxShadow: `0 0 0 3px color-mix(in srgb, ${state} 20%, transparent)` }} />
    <span className="num">{shown.toLocaleString()}</span>
    <span className="muted" style={{ fontSize: 13 }}>tokens</span>
  </Link>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [empty, setEmpty] = useState(false);
  const refresh = () => api('/me').then(setUser, () => setUser(null));
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const on = () => { setEmpty(true); setUser(u => u && { ...u, credits: 0 }); };
    window.addEventListener('credits:empty', on);
    return () => window.removeEventListener('credits:empty', on);
  }, []);

  if (user === undefined) return null;
  if (!user) return <Routes>
    <Route path="/" element={<Landing onLogin={setUser} />} />
    <Route path="*" element={<Login onLogin={setUser} />} />
  </Routes>;

  const setCredits = credits => {
    if (credits == null) return;
    setUser(u => ({ ...u, credits }));
    if (credits > 0) setEmpty(false);
  };
  const logout = () => api('/logout', { method: 'POST' }).then(() => setUser(null));
  const props = { user, setCredits, refresh };
  const tab = (to, label) => <NavLink to={to} viewTransition className="tab">{label}</NavLink>;

  return <>
    <nav>
      <span className="brand">StudyMate</span>
      {tab('/notes', 'Notes')}{tab('/chat', 'Tutor')}{tab('/quiz', 'Quiz')}{tab('/dashboard', 'Progress')}{tab('/wallet', 'Wallet')}
      <span className="right">
        <CreditMeter credits={user.credits} />
        <ThemeToggle />
        <button className="ghost" onClick={logout}>Log out</button>
      </span>
    </nav>
    {empty && <div role="alert" className="rise" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', padding: '10px 20px', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
      You're out of tokens. <Link to="/wallet" viewTransition style={{ color: 'inherit', fontWeight: 600 }}>Recharge to keep studying →</Link>
    </div>}
    <main>
      <Routes>
        <Route path="/notes" element={<Notes {...props} />} />
        <Route path="/chat" element={<Chat {...props} />} />
        <Route path="/quiz" element={<Quiz {...props} />} />
        <Route path="/quiz/:id" element={<Quiz {...props} />} />
        <Route path="/dashboard" element={<Dashboard {...props} />} />
        <Route path="/wallet" element={<Wallet {...props} />} />
        <Route path="*" element={<Navigate to="/notes" />} />
      </Routes>
    </main>
  </>;
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
