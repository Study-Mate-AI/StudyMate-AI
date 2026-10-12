import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, GoogleButton, ThemeToggle } from '../App.jsx';

const css = `
.auth { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); }
.auth-hero { padding: 40px clamp(24px, 5vw, 72px); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 36px; overflow: hidden;
  background: radial-gradient(120% 80% at 0% 0%, var(--accent-soft), transparent 60%), var(--paper); }
.auth-hero h1 { font-size: clamp(40px, 5.2vw, 64px); line-height: 1.02; letter-spacing: -0.035em; margin: 0; max-width: 11ch; }
.auth-hero h1 em { font-family: var(--serif); font-weight: 400; letter-spacing: -0.01em; color: var(--accent); }
.desk { position: relative; height: 300px; max-width: 520px; }
.desk > * { position: absolute; border-radius: 6px; box-shadow: 0 1px 1px rgb(0 0 0 / .04), 0 12px 32px -12px rgb(0 0 0 / .18); }
.sheet { inset: 0 60px 0 0; padding: 22px 22px 22px 54px; transform: rotate(-2deg); border: 1px solid var(--line); font-size: 14px; line-height: 28px; color: var(--ink-2); }
.sheet::before { content: ''; position: absolute; left: 40px; top: 0; bottom: 0; width: 1px; background: var(--margin); }
.sheet b { display: block; font: 400 22px/28px var(--serif); color: var(--ink); }
.answer { right: 0; bottom: -14px; width: 290px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--line); transform: rotate(1.5deg); font-size: 14px; }
.cite { font: 500 11px/1 var(--mono); padding: 3px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); white-space: nowrap; }
.score { right: 24px; top: -10px; padding: 8px 12px; background: var(--ink); color: var(--paper); font-size: 13px; transform: rotate(3deg); display: flex; gap: 10px; align-items: baseline; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: auto; padding-top: 24px; border-top: 1px solid var(--line); font-size: 13px; color: var(--ink-2); }
.facts strong { display: block; font: 500 20px/1.3 var(--mono); color: var(--ink); letter-spacing: -0.03em; }
.auth-side { position: relative; display: grid; place-items: center; padding: 48px 20px; }
.field-row { display: flex; justify-content: space-between; align-items: baseline; }
.field-row a { font-size: 13px; font-weight: 400; }
.sent { display: grid; gap: 6px; padding: 14px 16px; border-radius: 10px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); font-size: 14px; }
.auth-card { width: 100%; max-width: 380px; display: grid; gap: 16px; }
.auth-card h2 { margin: 0; }
.or { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--ink-3); } .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.pw { position: relative; } .pw input { padding-right: 64px; }
.pw button { position: absolute; right: 4px; top: 50%; translate: 0 -50%; padding: 4px 10px; font-size: 12px; background: transparent; color: var(--ink-2); border: 0; }
.pw button:hover { color: var(--ink); background: var(--line); }
.strength { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.strength i { height: 3px; border-radius: 3px; background: var(--line); transition: background .3s; }
.bonus { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px dashed var(--accent); border-radius: 10px; background: var(--accent-soft); font-size: 13px; color: var(--ink-2); }
.bonus .num { font-size: 20px; font-weight: 600; color: var(--accent); }
@media (max-width: 880px) {
  .auth { grid-template-columns: 1fr; }
  .auth-hero { border-right: 0; border-bottom: 1px solid var(--line); gap: 20px; }
  .desk, .facts { display: none; }
}`;

const MODES = {
  login: ['Welcome back', 'Log in to pick up where you left off.'],
  signup: ['Create your account', 'Start with a free balance. No card needed.'],
  forgot: ['Forgot your password?', "Enter your account's email and we'll send you a link to reset it."],
  reset: ['Choose a new password', 'This also logs you out on every other device.'],
};
const BUTTON = { login: ['Log in', 'Logging in…'], signup: ['Create account', 'Creating account…'], forgot: ['Send reset link', 'Sending…'], reset: ['Save new password', 'Saving…'] };

function strength(pw) {
  const s = (pw.length >= 8) + (pw.length >= 12) + (/[a-z]/i.test(pw) && /[^a-z]/i.test(pw));
  return [s, ['Too short', 'Okay', 'Good', 'Strong'][s], ['var(--bad)', 'var(--warn)', 'var(--accent)', 'var(--good)'][s]];
}

export default function Login({ onLogin }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const { pathname } = useLocation();
  const [mode, setMode] = useState(token ? 'reset' : pathname === '/signup' ? 'signup' : 'login');
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState('');
  const signup = mode === 'signup', newPw = signup || mode === 'reset';
  const [score, label, color] = strength(pw);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = Object.fromEntries(new FormData(e.target));
    try {
      if (mode === 'forgot') { await api('/forgot', { body }); setSent(body.email); setBusy(false); return; }
      const user = await api('/' + mode, { body: mode === 'reset' ? { ...body, token } : body });
      if (mode === 'reset') navigate('/notes', { replace: true }); // drop the token from the URL
      onLogin(user);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const switchTo = m => { setMode(m); setErr(''); setSent(''); setPw(''); };
  const link = (m, text) => <a href="#" onClick={e => { e.preventDefault(); switchTo(m); }}>{text}</a>;

  return <div className="auth">
    <style>{css}</style>
    <section className="auth-hero">
      <Link to="/" className="brand" style={{ fontFamily: 'var(--serif)', fontSize: 24, color: 'var(--ink)', textDecoration: 'none' }}>StudyMate</Link>
      <div>
        <h1>Study from <em>your own</em> notes.</h1>
        <p style={{ color: 'var(--ink-2)', fontSize: 17, maxWidth: '44ch', margin: '18px 0 0' }}>
          Upload lecture PDFs and class notes. Ask questions and get answers that cite your pages, then take quizzes that show what you still need to learn.
        </p>
      </div>

      <div className="desk" aria-hidden>
        <div className="sheet ruled">
          <b>Cell Biology, Lecture 4</b>
          The mitochondrion is the site of <mark>aerobic respiration</mark>, where glucose is broken down to release energy stored as ATP.
          Its inner membrane folds into cristae, which increase the surface area for the electron transport chain.
        </div>
        <div className="score"><span className="eyebrow" style={{ color: 'inherit', opacity: .6 }}>Quiz</span><span className="num">8/10</span></div>
        <div className="answer">
          <p className="eyebrow" style={{ margin: '0 0 8px' }}>Tutor</p>
          Cristae increase the inner membrane's surface area, so more ATP can be made. <span className="cite">Source 1 · Lecture 4</span>
        </div>
      </div>

      <div className="facts">
        <span><strong>10,000</strong>free tokens when you sign up</span>
        <span><strong>[1]</strong>every answer cites your notes</span>
        <span><strong>&lt;70%</strong>topics flagged for review</span>
      </div>
    </section>

    <section className="auth-side">
      <ThemeToggle style={{ position: 'absolute', top: 20, right: 20 }} />
      <form className="auth-card" onSubmit={submit}>
        {(mode === 'login' || signup) && <div className="seg" role="group" aria-label="Account" style={{ justifySelf: 'start' }}>
          <button type="button" aria-pressed={!signup} onClick={() => switchTo('login')}>Log in</button>
          <button type="button" aria-pressed={signup} onClick={() => switchTo('signup')}>Sign up</button>
        </div>}
        <div>
          <h2>{MODES[mode][0]}</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>{MODES[mode][1]}</p>
        </div>

        {sent ? <div className="sent rise" role="status">
          <strong>Check your inbox</strong>
          <span className="muted">If an account exists for {sent}, a reset link is on its way. It expires in 30 minutes.</span>
        </div> : <>
        {mode !== 'reset' && <label className="field">Email
          <input name="email" type="email" placeholder="you@university.edu" autoComplete="email" required />
        </label>}
        {mode !== 'forgot' && <div className="field">
          <span className="field-row">
            <label htmlFor="password">{mode === 'reset' ? 'New password' : 'Password'}</label>
            {mode === 'login' && link('forgot', 'Forgot password?')}
          </span>
          <span className="pw">
            <input id="password" name="password" type={show ? 'text' : 'password'} minLength={8} maxLength={72} required value={pw} onChange={e => setPw(e.target.value)}
              placeholder={newPw ? 'At least 8 characters' : ''} autoComplete={newPw ? 'new-password' : 'current-password'} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </div>}
        {newPw && <div style={{ display: 'grid', gap: 6, marginTop: -6 }}>
          <div className="strength" aria-hidden>{[0, 1, 2].map(i => <i key={i} style={{ background: pw && i < Math.max(score, 1) ? color : undefined }} />)}</div>
          <span style={{ fontSize: 12, color: pw ? color : 'var(--ink-3)' }}>{pw ? label : 'Use 12+ characters with a number or symbol for a strong password.'}</span>
        </div>}

        {signup && <div className="bonus rise">
          <span className="num">+10,000</span>
          <span>free AI tokens added to your wallet, enough for plenty of tutor questions and quizzes.</span>
        </div>}

        <button disabled={busy} style={{ padding: '11px 14px' }}>{BUTTON[mode][+busy]}</button>
        {(mode === 'login' || signup) && <><div className="or">or</div><div style={{ justifySelf: 'center' }}><GoogleButton onLogin={onLogin} /></div></>}
        </>}
        {err && <p role="alert" className="err" style={{ margin: 0, fontSize: 14 }}>{err}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
          {mode === 'login' ? <>New to StudyMate? {link('signup', 'Create one')}</>
            : signup ? <>Already have an account? {link('login', 'Log in')}</>
            : link('login', '← Back to log in')}
        </p>
      </form>
    </section>
  </div>;
}
