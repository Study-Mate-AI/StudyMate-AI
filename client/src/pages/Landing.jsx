import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GoogleButton, ThemeToggle, useTween } from '../App.jsx';

const PRICE = { pack: import.meta.env.VITE_PACK_PRICE || '$5', pro: import.meta.env.VITE_PRO_PRICE || '$9' };

const css = `
.lp { overflow-x: clip; }
.lp section { max-width: 1120px; margin: 0 auto; padding: 96px 24px; }
.lp h2 { font-size: clamp(30px, 4vw, 46px); letter-spacing: -0.035em; line-height: 1.05; margin: 10px 0 14px; }
.lp h2 em { font-family: var(--serif); font-weight: 400; color: var(--accent); letter-spacing: -0.01em; }
.lp .lede { color: var(--ink-2); font-size: 17px; max-width: 56ch; margin: 0; }

/* nav */
.lp-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 22px; padding: 14px clamp(16px, 4vw, 40px); transition: background .3s, border-color .3s, backdrop-filter .3s;
  border-bottom: 1px solid transparent; }
.lp-nav.scrolled { background: color-mix(in srgb, var(--paper) 78%, transparent); backdrop-filter: blur(14px); border-color: var(--line); }
.lp-nav .brand { font-family: var(--serif); font-size: 24px; color: var(--ink); text-decoration: none; }
.lp-nav .links { display: flex; gap: 22px; margin-left: 12px; } .lp-nav .links a { color: var(--ink-2); text-decoration: none; font-size: 14px; } .lp-nav .links a:hover { color: var(--ink); }
.lp-nav .right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
@media (max-width: 760px) { .lp-nav .links { display: none; } .lp-nav .right .btn { padding: 7px 11px; font-size: 14px; } .lp-nav .brand { font-size: 21px; } }

/* hero */
.hero { position: relative; display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: center; padding-top: 72px !important; min-height: min(86vh, 760px); }
.hero h1 { font-size: clamp(44px, 6.4vw, 84px); line-height: .98; letter-spacing: -0.045em; margin: 18px 0 22px; }
.hero h1 .w { display: inline-block; opacity: 0; transform: translateY(.45em) rotate(2deg); filter: blur(6px); animation: word .9s var(--ease) forwards; animation-delay: calc(var(--i) * 70ms + 150ms); }
.hero h1 em { font-family: var(--serif); font-weight: 400; color: var(--accent); letter-spacing: -0.02em; }
@keyframes word { to { opacity: 1; transform: none; filter: none; } }
.fade-up { opacity: 0; transform: translateY(14px); animation: fadeUp .8s var(--ease) forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 6px; border-radius: 99px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; color: var(--ink-2); }
.pill b { font: 600 11px/1 var(--mono); padding: 4px 7px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); }
.ctas { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 30px; }
.btn.lg { padding: 13px 22px; font-size: 16px; border-radius: 10px; }
.btn.shine { position: relative; overflow: hidden; }
.btn.shine::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgb(255 255 255 / .35) 50%, transparent 70%); translate: -120% 0; animation: shine 3.2s 1.6s infinite; }
@keyframes shine { 40%, 100% { translate: 120% 0; } }
.fine { margin-top: 14px; font-size: 13px; color: var(--ink-3); }
.blob { position: absolute; z-index: -1; width: 520px; aspect-ratio: 1; border-radius: 50%; filter: blur(70px); opacity: .55; pointer-events: none; animation: drift 18s ease-in-out infinite alternate; }
.blob.a { background: var(--accent-soft); top: -120px; left: -160px; }
.blob.b { background: color-mix(in srgb, var(--hl) 55%, transparent); bottom: -140px; right: -120px; width: 420px; animation-duration: 22s; animation-direction: alternate-reverse; }
@keyframes drift { to { transform: translate(90px, 60px) scale(1.15); } }
.grid-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image: radial-gradient(var(--line-2) 1px, transparent 1px); background-size: 26px 26px;
  mask-image: radial-gradient(70% 60% at 50% 40%, #000 30%, transparent 75%); opacity: .7; }

/* hero product mock with pointer parallax */
.stage { position: relative; height: 470px; perspective: 1200px; }
.stage > * { position: absolute; transition: transform .25s ease-out; }
.mock-note { inset: 10px 70px 60px 0; border: 1px solid var(--line); border-radius: 10px; padding: 24px 24px 24px 58px; font-size: 14px; line-height: 28px; color: var(--ink-2);
  box-shadow: 0 30px 60px -30px rgb(0 0 0 / .35); transform: rotate(-2.5deg) translate(calc(var(--mx) * -10px), calc(var(--my) * -8px)); }
.mock-note::before { content: ''; position: absolute; left: 42px; top: 0; bottom: 0; width: 1px; background: var(--margin); }
.mock-note b { display: block; font: 400 24px/28px var(--serif); color: var(--ink); margin-bottom: 4px; }
.mock-note mark { background-size: 0% 70%; animation: sweep 1.1s 1.4s var(--ease) forwards; }
@keyframes sweep { to { background-size: 100% 70%; } }
.mock-chat { right: 0; bottom: 18px; width: min(330px, 80%); padding: 16px 18px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); font-size: 14px;
  box-shadow: 0 30px 60px -24px rgb(0 0 0 / .4); transform: rotate(1.5deg) translate(calc(var(--mx) * 16px), calc(var(--my) * 12px)); }
.mock-chat .q { font-size: 12px; color: var(--ink-3); margin-bottom: 8px; display: flex; gap: 6px; align-items: center; }
.caret { display: inline-block; width: 2px; height: 1em; background: var(--accent); vertical-align: -2px; margin-left: 1px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.lp .cite { font: 600 10.5px/1 var(--mono); padding: 3px 6px; border-radius: 5px; background: var(--accent-soft); color: var(--accent); }
.mock-score { right: 30px; top: 0; padding: 12px 16px; border-radius: 12px; background: var(--ink); color: var(--paper); display: grid; gap: 2px;
  transform: rotate(4deg) translate(calc(var(--mx) * 22px), calc(var(--my) * 18px)); box-shadow: 0 20px 40px -20px rgb(0 0 0 / .5); animation: bob 5s ease-in-out infinite; }
.mock-score small { font: 500 10px/1 var(--mono); letter-spacing: .08em; opacity: .6; text-transform: uppercase; }
.mock-weak { left: -14px; bottom: 0; padding: 10px 14px; border-radius: 10px; background: var(--surface); border: 1px solid var(--line); font-size: 13px; display: flex; gap: 8px; align-items: center;
  transform: rotate(-3deg) translate(calc(var(--mx) * 26px), calc(var(--my) * 20px)); box-shadow: 0 16px 30px -18px rgb(0 0 0 / .35); animation: bob 6s 1s ease-in-out infinite; }
@keyframes bob { 50% { translate: 0 -8px; } }
@media (max-width: 900px) { .hero { grid-template-columns: 1fr; min-height: 0; } .stage { height: 400px; } }
@media (max-width: 480px) { .stage { height: 360px; } .mock-note { inset: 10px 10px 90px 0; } .mock-weak { display: none; } }

/* marquee */
.marquee { border-block: 1px solid var(--line); padding: 18px 0; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.marquee .track { display: flex; gap: 44px; width: max-content; animation: scroll 38s linear infinite; }
.marquee:hover .track { animation-play-state: paused; }
.marquee span { font-family: var(--serif); font-size: 26px; color: var(--ink-3); white-space: nowrap; display: flex; align-items: center; gap: 44px; }
.marquee span::after { content: '✦'; font-size: 12px; color: var(--accent); }
@keyframes scroll { to { transform: translateX(-50%); } }

/* reveal on scroll */
[data-reveal] { opacity: 0; transform: translateY(26px); transition: opacity .8s var(--ease), transform .8s var(--ease); transition-delay: var(--d, 0ms); }
[data-reveal].in { opacity: 1; transform: none; }

/* bento features with cursor spotlight */
.bento { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-top: 44px; }
.feat { position: relative; grid-column: span 2; padding: 26px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); overflow: hidden; isolation: isolate;
  transition: transform .4s var(--ease), border-color .3s; }
.feat.wide { grid-column: span 3; } .feat.full { grid-column: 1 / -1; } .feat.full .demo { max-width: 520px; }
.feat::before { content: ''; position: absolute; inset: 0; z-index: -1; opacity: 0; transition: opacity .3s;
  background: radial-gradient(380px circle at var(--x, 50%) var(--y, 50%), color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%); }
.feat:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.feat:hover::before { opacity: 1; }
.feat .ic { width: 42px; height: 42px; border-radius: 11px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); margin-bottom: 18px; }
.feat h3 { margin: 0 0 6px; font-size: 18px; } .feat p { margin: 0; color: var(--ink-2); font-size: 14.5px; }
.feat .demo { margin-top: 18px; font-size: 13px; }
@media (max-width: 900px) { .feat, .feat.wide { grid-column: span 3; } .feat.full { grid-column: 1 / -1; } }
@media (max-width: 620px) { .bento { grid-template-columns: 1fr; } .feat, .feat.wide, .feat.full { grid-column: auto; } }
.chips { display: flex; gap: 6px; flex-wrap: wrap; } .chips i { font-style: normal; padding: 4px 9px; border-radius: 99px; border: 1px solid var(--line-2); color: var(--ink-2); }
.bar { height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; } .bar i { display: block; height: 100%; width: 0; border-radius: 6px; transition: width 1.4s .3s var(--ease); }
.in .bar i { width: var(--w); }

/* steps */
.steps { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 52px; }
.steps::before { content: ''; position: absolute; top: 22px; left: 8%; right: 8%; height: 2px; background: linear-gradient(90deg, var(--accent), var(--hl)); transform: scaleX(0); transform-origin: left;
  transition: transform 1.6s .2s var(--ease); }
.steps.in::before { transform: scaleX(1); }
.step .n { position: relative; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--paper); border: 2px solid var(--accent); color: var(--accent); font: 600 15px var(--mono); margin-bottom: 18px; }
.step h3 { margin: 0 0 6px; font-size: 18px; } .step p { margin: 0; color: var(--ink-2); font-size: 14.5px; }
@media (max-width: 760px) { .steps { grid-template-columns: 1fr; } .steps::before { display: none; } }

/* stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--line); gap: 1px; }
.stats > div { background: var(--surface); padding: 28px 24px; }
.stats .num { font-size: clamp(30px, 4vw, 42px); font-weight: 500; display: block; }
.stats span:last-child { color: var(--ink-2); font-size: 14px; }
@media (max-width: 760px) { .stats { grid-template-columns: 1fr 1fr; } }

/* pricing */
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 44px; align-items: stretch; }
.plan { padding: 28px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; transition: transform .4s var(--ease); }
.plan:hover { transform: translateY(-4px); }
.plan.hot { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 30px 60px -36px var(--accent); position: relative; }
.plan.hot::after { content: 'Most popular'; position: absolute; top: -11px; right: 20px; font: 600 10px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; padding: 5px 9px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); }
.plan .price { font-family: var(--serif); font-size: 46px; line-height: 1; } .plan ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; font-size: 14.5px; color: var(--ink-2); flex: 1; }
.plan li::before { content: '✓'; color: var(--accent); margin-right: 8px; font-weight: 700; }
@media (max-width: 860px) { .plans { grid-template-columns: 1fr; } }

/* faq + cta */
.faq { margin-top: 36px; border-top: 1px solid var(--line); }
.faq details { border-bottom: 1px solid var(--line); padding: 18px 0; margin: 0; font-size: 15px; }
.faq summary { list-style: none; display: flex; justify-content: space-between; gap: 16px; color: var(--ink); font-weight: 500; font-size: 16px; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: '+'; font: 400 22px/1 var(--mono); color: var(--accent); transition: rotate .3s var(--ease); }
.faq details[open] summary::after { rotate: 45deg; }
.faq details p { margin: 10px 0 0; color: var(--ink-2); max-width: 70ch; }
.cta-band { position: relative; overflow: hidden; text-align: center; border-radius: 24px; padding: 72px 24px; background: var(--ink); color: var(--paper); isolation: isolate; }
.cta-band h2 em { color: var(--hl); }
.cta-band::before { content: ''; position: absolute; inset: -50%; z-index: -1; background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--accent) 45%, transparent), transparent 40%); animation: spin 14s linear infinite; }
.cta-band::after { content: ''; position: absolute; inset: 2px; z-index: -1; border-radius: 22px; background: var(--ink); opacity: .92; }
@keyframes spin { to { rotate: 1turn; } }
.cta-band .btn { background: var(--paper); color: var(--ink); border-color: var(--paper); }
.lp footer { max-width: 1120px; margin: 0 auto; padding: 32px 24px 48px; display: flex; gap: 16px; flex-wrap: wrap; justify-content: space-between; color: var(--ink-3); font-size: 13px; }
`;

const FEATURES = [
  { wide: true, icon: 'M4 4h11l5 5v11H4z M15 4v5h5', title: 'Upload any PDF or notes', text: 'Drop lecture slides, textbook chapters or typed notes. Every page is read, split into searchable pieces and organised by subject.',
    demo: <div className="chips"><i>Biology</i><i>Research Methodology</i><i>Data Mining</i><i>+ your subjects</i></div> },
  { wide: true, icon: 'M4 5h16v11H8l-4 4z', title: 'A tutor that cites its sources', text: 'Ask a doubt in plain words. Answers come only from your notes, with a numbered citation and page for every fact.',
    demo: <span>Mitochondria make ATP <span className="cite">p. 3</span> through respiration <span className="cite">p. 4</span></span> },
  { icon: 'M9 11l3 3 8-8 M20 12v7H4V5h11', title: 'Quizzes in seconds', text: 'Easy, Medium or Hard multiple-choice quizzes on any topic, written from your own material.' },
  { icon: 'M12 8v4l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', title: 'Instant grading', text: 'Submit and see your score, the right answers and a step-by-step explanation for each question.' },
  { icon: 'M3 7h18v12H3z M3 7l3-4h12l3 4 M16 13h2', title: 'Fair token wallet', text: 'Pay only for the AI you use. Uploading notes and taking quizzes cost nothing.' },
  { full: true, icon: 'M4 19V9 M10 19V5 M16 19v-7 M22 19H2', title: 'Weak-topic radar', text: 'Topics where your recent scores average under 70% get flagged, with one click to practise them.',
    demo: <div style={{ display: 'grid', gap: 8 }}>{[['Sampling', 42, 'var(--bad)'], ['Hypothesis testing', 64, 'var(--warn)'], ['Research design', 88, 'var(--good)']].map(([t, w, c]) =>
      <div key={t}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t}</span><span className="num">{w}%</span></div><div className="bar"><i style={{ '--w': w + '%', background: c }} /></div></div>)}</div> },
];

const STEPS = [
  ['Upload your notes', 'Add a PDF or paste text and pick a subject. Indexing is free.'],
  ['Ask and practise', 'Clear doubts with the tutor, then generate a quiz on the same topic.'],
  ['Fix weak spots', 'Your progress page shows what to revise next, so you study what matters.'],
];

const FAQ = [
  ['Does the AI use the internet to answer?', "No. The tutor only answers from the notes you upload, and says so when your notes don't cover a question. Every fact links back to the page it came from."],
  ['What are tokens?', 'Tokens measure AI usage. You get 10,000 free when you sign up, which is about 15 tutor answers or 7 quizzes. Uploading notes and taking quizzes are free.'],
  ['What files can I upload?', 'PDFs, Word (.docx), PowerPoint (.pptx), text files and photos of handwritten or printed notes (PNG, JPG, WebP). Photos and scanned PDFs are read by the AI, which uses a few tokens; everything else is indexed free.'],
  ['Is Pro a one-time payment?', 'Pro is monthly: 200,000 tokens every month, unused tokens carry over, and you can cancel anytime. Token packs are one-time purchases that never expire.'],
];

const Icon = ({ d }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

// Adds .in to [data-reveal] elements as they scroll into view (once).
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
    document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const ANSWER = 'Photosynthesis happens in the chloroplasts, where light energy is turned into glucose';
function Typing() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(ANSWER.length);
    let i = 0;
    const t = setTimeout(function tick() { setN(++i); if (i < ANSWER.length) setTimeout(tick, 28); }, 1600);
    return () => clearTimeout(t);
  }, []);
  return <>{ANSWER.slice(0, n)}{n === ANSWER.length ? <> <span className="cite">p. 3</span></> : <span className="caret" />}</>;
}

function Counter({ to, suffix = '' }) {
  const ref = useRef();
  const [go, setGo] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setGo(true), { threshold: 0.5 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const v = useTween(go ? to : 0, 1400);
  return <span ref={ref} className="num">{v.toLocaleString()}{suffix}</span>;
}

export default function Landing({ onLogin }) {
  const [scrolled, setScrolled] = useState(false);
  const stage = useRef();
  useReveal();
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);

  // Pointer parallax for the hero mock: -1..1 on each axis, written as CSS vars.
  const tilt = e => {
    const r = stage.current.getBoundingClientRect();
    stage.current.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
    stage.current.style.setProperty('--my', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
  };
  const spot = e => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--x', e.clientX - r.left + 'px');
    e.currentTarget.style.setProperty('--y', e.clientY - r.top + 'px');
  };
  const words = ['Study', 'from', 'your', 'notes,'];

  return <div className="lp">
    <style>{css}</style>
    <nav className={'lp-nav' + (scrolled ? ' scrolled' : '')}>
      <Link to="/" className="brand">StudyMate</Link>
      <div className="links"><a href="#features">Features</a><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div>
      <div className="right">
        <ThemeToggle />
        <Link to="/login" className="btn ghost login">Log in</Link>
        <Link to="/signup" className="btn">Start free</Link>
      </div>
    </nav>

    <section className="hero">
      <div className="blob a" /><div className="blob b" /><div className="grid-bg" />
      <div>
        <span className="pill fade-up"><b>NEW</b> AI tutor with page-level citations</span>
        <h1>
          {words.map((w, i) => <span key={i}><span className="w" style={{ '--i': i }}>{w}</span> </span>)}
          <em><span className="w" style={{ '--i': 4 }}>not</span> <span className="w" style={{ '--i': 5 }}>the</span> <span className="w" style={{ '--i': 6 }}>internet.</span></em>
        </h1>
        <p className="lede fade-up" style={{ '--d': '700ms' }}>Upload your lecture notes and StudyMate turns them into a personal tutor, instant quizzes and a progress report that tells you exactly what to revise.</p>
        <div className="ctas fade-up" style={{ '--d': '850ms' }}>
          <Link to="/signup" className="btn lg shine">Get 10,000 free tokens →</Link>
          <a href="#how" className="btn ghost lg">See how it works</a>
        </div>
        <div className="fade-up" style={{ '--d': '950ms', marginTop: 16 }}><GoogleButton onLogin={onLogin} /></div>
        <p className="fine fade-up" style={{ '--d': '1000ms' }}>No card needed · PDF, Word, PowerPoint or photos</p>
      </div>

      <div className="stage fade-up" style={{ '--d': '400ms', '--mx': 0, '--my': 0 }} ref={stage} onPointerMove={tilt}
        onPointerLeave={() => { stage.current.style.setProperty('--mx', 0); stage.current.style.setProperty('--my', 0); }} aria-hidden>
        <div className="mock-note ruled">
          <b>Lecture 4: Plant cells</b>
          Plants capture sunlight using chlorophyll. <mark>Photosynthesis takes place in the chloroplasts</mark>, converting light energy, water and carbon dioxide into glucose and oxygen.
        </div>
        <div className="mock-score"><small>Quiz · Medium</small><span className="num" style={{ fontSize: 26 }}>9/10</span></div>
        <div className="mock-weak"><span style={{ color: 'var(--bad)' }}>⚑</span> Weak topic: <strong>Cell respiration</strong></div>
        <div className="mock-chat">
          <div className="q"><span className="dot" style={{ background: 'var(--accent)' }} /> Where does photosynthesis happen?</div>
          <Typing />
        </div>
      </div>
    </section>

    <div className="marquee" aria-hidden>
      <div className="track">{[0, 1].map(k => <span key={k}>{['Biology', 'Research Methodology', 'Data Mining', 'Organic Chemistry', 'Operating Systems', 'Microeconomics', 'Thermodynamics', 'Constitutional Law'].map(s => <span key={s}>{s}</span>)}</span>)}</div>
    </div>

    <section id="features">
      <p className="eyebrow" data-reveal>Features</p>
      <h2 data-reveal style={{ '--d': '80ms' }}>Everything you need to <em>actually learn</em> it</h2>
      <p className="lede" data-reveal style={{ '--d': '160ms' }}>One place for your notes, your doubts and your practice, all grounded in what your teacher actually taught.</p>
      <div className="bento">
        {FEATURES.map((f, i) => <article key={f.title} className={'feat' + (f.wide ? ' wide' : '') + (f.full ? ' full' : '')} data-reveal style={{ '--d': i * 90 + 'ms' }} onPointerMove={spot}>
          <div className="ic"><Icon d={f.icon} /></div>
          <h3>{f.title}</h3><p>{f.text}</p>
          {f.demo && <div className="demo">{f.demo}</div>}
        </article>)}
      </div>
    </section>

    <section id="how">
      <p className="eyebrow" data-reveal>How it works</p>
      <h2 data-reveal style={{ '--d': '80ms' }}>From notes to <em>exam-ready</em> in three steps</h2>
      <div className="steps" data-reveal>
        {STEPS.map(([t, d], i) => <div className="step" key={t} data-reveal style={{ '--d': 300 + i * 200 + 'ms' }}>
          <div className="n">0{i + 1}</div><h3>{t}</h3><p>{d}</p>
        </div>)}
      </div>
    </section>

    <section style={{ paddingTop: 0 }}>
      <div className="stats" data-reveal>
        <div><Counter to={10000} /><span>free tokens on signup</span></div>
        <div><Counter to={15} /><span>tutor answers on the free balance</span></div>
        <div><Counter to={3} /><span>difficulty levels per quiz</span></div>
        <div><Counter to={100} suffix="%" /><span>answers grounded in your notes</span></div>
      </div>
    </section>

    <section id="pricing">
      <p className="eyebrow" data-reveal>Pricing</p>
      <h2 data-reveal style={{ '--d': '80ms' }}>Start free. <em>Top up</em> when you need to.</h2>
      <div className="plans">
        {[
          { t: 'Free', p: '$0', n: 'to start', pts: ['10,000 tokens on signup', 'Every feature included', 'Top up anytime'] },
          { t: 'Token pack', p: PRICE.pack, n: 'one-time', pts: ['50,000 tokens', 'Never expire', 'Stacks with any plan'] },
          { t: 'Pro', p: PRICE.pro, n: 'per month', hot: true, pts: ['200,000 tokens every month', 'Unused tokens carry over', 'Cancel anytime'] },
        ].map((x, i) => <div key={x.t} className={'plan' + (x.hot ? ' hot' : '')} data-reveal style={{ '--d': i * 120 + 'ms' }}>
          <strong>{x.t}</strong>
          <div><span className="price">{x.p}</span> <span className="muted">{x.n}</span></div>
          <ul>{x.pts.map(p => <li key={p}>{p}</li>)}</ul>
          <Link to="/signup" className={'btn' + (x.hot ? ' accent' : ' ghost')}>{x.hot ? 'Start free, upgrade later' : 'Get started'}</Link>
        </div>)}
      </div>
    </section>

    <section id="faq" style={{ paddingTop: 0 }}>
      <p className="eyebrow" data-reveal>FAQ</p>
      <h2 data-reveal style={{ '--d': '80ms' }}>Questions, <em>answered</em></h2>
      <div className="faq" data-reveal>{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
    </section>

    <section style={{ paddingTop: 0 }}>
      <div className="cta-band" data-reveal>
        <h2 style={{ margin: '0 0 12px' }}>Your next exam, <em>sorted.</em></h2>
        <p style={{ opacity: .75, margin: '0 auto 28px', maxWidth: '48ch' }}>Upload one set of notes and see how fast you can find, test and fix what you don't know yet.</p>
        <Link to="/signup" className="btn lg">Create your free account →</Link>
      </div>
    </section>

    <footer><span className="serif" style={{ fontSize: 18, color: 'var(--ink)' }}>StudyMate</span><span>B.Tech project · Built with MongoDB, Express, React, Node and Google Gemini</span></footer>
  </div>;
}
