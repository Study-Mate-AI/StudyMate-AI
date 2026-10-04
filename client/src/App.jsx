import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Notes from './pages/Notes.jsx';
import Chat from './pages/Chat.jsx';
import Quiz from './pages/Quiz.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Wallet from './pages/Wallet.jsx';

export const LOW = 1000;

export async function api(path, { body, method, form } = {}) {
  const res = await fetch('/api' + path, {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 402) window.dispatchEvent(new Event('credits:empty'));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
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
  if (!user) return <Login onLogin={setUser} />;

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
        <button className="ghost" onClick={logout}>Log out</button>
      </span>
    </nav>
    {empty && <div role="alert" className="rise" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', padding: '10px 20px', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
      You're out of tokens. <Link to="/wallet" viewTransition style={{ color: 'inherit', fontWeight: 600 }}>Recharge to keep studying →</Link>
    </div>}
    <main>
      <Routes>
        <Route path="/notes" element={<Notes />} />
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

// Subjects come from the notes list; shared by Chat and Quiz.
export function useSubjects() {
  const [subjects, setSubjects] = useState([]);
  useEffect(() => { api('/notes').then(n => setSubjects([...new Set(n.map(x => x.subject))])); }, []);
  return subjects;
}
