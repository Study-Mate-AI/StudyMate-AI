import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Notes from './pages/Notes.jsx';
import Chat from './pages/Chat.jsx';
import Quiz from './pages/Quiz.jsx';
import Dashboard from './pages/Dashboard.jsx';

export async function api(path, { body, method, form } = {}) {
  const res = await fetch('/api' + path, {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body && JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => { api('/me').then(setUser, () => setUser(null)); }, []);

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  const setCredits = credits => credits != null && setUser(u => ({ ...u, credits }));
  const logout = () => api('/logout', { method: 'POST' }).then(() => setUser(null));
  const props = { user, setCredits };

  return <>
    <nav>
      <strong>StudyMate AI</strong>
      <NavLink to="/notes">Notes</NavLink>
      <NavLink to="/chat">Tutor</NavLink>
      <NavLink to="/quiz">Quiz</NavLink>
      <NavLink to="/dashboard">Progress</NavLink>
      <span className="right">
        <span title="AI tokens left">🪙 {user.credits.toLocaleString()}</span>
        {user.plan === 'pro' && <span className="good">PRO</span>}
        <button className="ghost" onClick={logout}>Log out</button>
      </span>
    </nav>
    <main>
      <Routes>
        <Route path="/notes" element={<Notes />} />
        <Route path="/chat" element={<Chat {...props} />} />
        <Route path="/quiz" element={<Quiz {...props} />} />
        <Route path="/quiz/:id" element={<Quiz {...props} />} />
        <Route path="/dashboard" element={<Dashboard {...props} />} />
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
