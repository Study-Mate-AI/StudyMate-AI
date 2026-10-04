import { useState } from 'react';
import { api } from '../App.jsx';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [err, setErr] = useState('');

  const submit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    api('/' + mode, { body: f }).then(onLogin, e => setErr(e.message));
  };

  return <main style={{ maxWidth: 380 }}>
    <h1>StudyMate AI</h1>
    <p className="muted">Answers from your own notes, quizzes that find your weak spots.</p>
    <form className="card" onSubmit={submit} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <input name="email" type="email" placeholder="Email" autoComplete="email" required aria-label="Email" />
      <input name="password" type="password" placeholder="Password (8+ chars)" minLength={8} required aria-label="Password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      <button>{mode === 'login' ? 'Log in' : 'Sign up — get 10,000 free tokens'}</button>
      {err && <span className="err">{err}</span>}
    </form>
    <button className="ghost" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>
      {mode === 'login' ? 'New here? Sign up' : 'Have an account? Log in'}
    </button>
  </main>;
}
