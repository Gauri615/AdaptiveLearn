import React, { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2, CircleHelp, Lightbulb, RefreshCw, ShieldCheck, Target } from 'lucide-react';

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export default function LearningIntelligence({ notify, go, user }) {
  const [profile, setProfile] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('practice');
  const [question, setQuestion] = useState('');
  const [tutor, setTutor] = useState(null);
  const [tutorBusy, setTutorBusy] = useState(false);
  const [verification, setVerification] = useState(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [hintBusy, setHintBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [p, r] = await Promise.all([api('/api/learning/profile'), api('/api/learning/recommendation')]);
      setProfile(p); setRecommendation(r.recommendation); 
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const askTutor = async e => {
    e.preventDefault(); setTutorBusy(true);
    try {
      const data = await api('/api/learning/tutor', { method: 'POST', body: { mode, question, challengeId: recommendation?.challenge_id } });
      setTutor(data); 
    } catch (e) { notify(e.message, 'error'); }
    finally { setTutorBusy(false); }
  };
  const requestHint = async level => {
    if (!recommendation?.challenge_id) return;
    setHintBusy(true);
    try {
      await api('/api/learning/hints', { method: 'POST', body: { challengeId: recommendation.challenge_id, hintLevel: level } });
      setHintLevel(level);
      notify(`Hint level ${level} recorded. Hint use is not treated as proof of low mastery.`);
    } catch (e) { notify(e.message, 'error'); }
    finally { setHintBusy(false); }
  };
  const hintText = {
    1: 'Conceptual direction: restate the goal in your own words and identify what information must be tracked.',
    2: 'Relevant observation: test a very small input by hand and note what changes at each step.',
    3: 'Algorithmic approach: write the steps in plain language, then check that each step handles the required constraints.',
    4: 'Pseudocode scaffold: read input → initialize the state you need → process each item/case → handle boundaries → produce output. Adapt each step to the actual problem.'
  };
  const startVerification = async () => {
    if (!recommendation?.challenge_id) return;
    try {
      const data = await api('/api/learning/verification/start', { method: 'POST', body: { challengeId: recommendation.challenge_id } });
      setVerification(data);
      notify('Independent verification challenge selected from the reviewed question bank.');
    } catch (e) { notify(e.message, 'error'); }
  };

  if (loading) return <div className="panel centered-state"><div className="loading-spinner"/><h3>Building your evidence profile…</h3></div>;
  if (error) return <div className="panel centered-state error-state"><h3>Learning intelligence is unavailable</h3><p>{error}</p><button className="primary-button" onClick={load}><RefreshCw size={15}/> Try again</button><span className="mini-muted">Apply migration 003_adaptix_mastery_engine.sql if this is a fresh database.</span></div>;

  const skills = profile?.skills || [];
  return <div className="learning-intelligence">
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">PROOF OF MASTERY</div><h3>My Skills</h3><p>Estimates use recorded evidence; they are not a measure of intelligence.</p></div><BrainCircuit size={19}/></div>
      {skills.length ? <div className="mastery-skill-grid">{skills.map(skill => <article className="mastery-skill" key={skill.concept_id}>
        <div className="mastery-skill-top"><strong>{skill.title}</strong><span className={`mastery-status ${skill.status.toLowerCase().replaceAll(' ','-')}`}>{skill.status}</span></div>
        {skill.attempts > 0 ? <><div className="bar-track"><i style={{width:`${Math.max(0,Math.min(100,skill.mastery_score))}%`}}/></div><div className="mastery-meta"><span>{skill.mastery_score}% recorded estimate</span><span>{skill.attempts} diagnostic attempts</span></div></> : <p className="mini-muted">Insufficient evidence — not assessed yet.</p>}
        <p className="mini-muted">{skill.evidence}{skill.independent_passes ? ` · ${skill.independent_passes} independent pass(es)` : ''}</p>
      </article>)}</div> : <p>No topic profile is available yet. Complete the Learning DNA assessment first.</p>}
      <p className="mini-muted">{profile?.scoring?.note}</p>
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">NEXT BEST ACTION</div><h3>Recommended Practice</h3><p>Selected from your available question bank and recorded evidence.</p></div><Target size={19}/></div>
      {recommendation ? <div className="recommended-problem"><div><span className="small-tag">{recommendation.difficulty}</span><h4>{recommendation.challenge_title}</h4><p>{recommendation.action}</p><p className="recommendation-reason"><Lightbulb size={15}/>{recommendation.reason}</p><span className="mini-muted">Topic: {recommendation.concept_title} · Previous attempts: {recommendation.evidence.priorQuestionAttempts}</span></div>
        <div className="recommendation-actions"><button className="primary-button" onClick={()=>go('coding')}>Open Coding Arena</button><button className="secondary-button" onClick={startVerification}>Prepare verification</button></div>
      </div> : <p>No eligible published questions yet. Ask a trainer to publish a reviewed question.</p>}
      {recommendation && <div className="progressive-hints"><strong>Progressive hints</strong><p>Request only as much guidance as you need. Each request is recorded as context, not a penalty.</p><div className="hint-levels">{[1,2,3,4].map(level=><button key={level} className={hintLevel===level?'active':''} disabled={hintBusy} onClick={()=>requestHint(level)}>Hint {level}</button>)}</div>{hintLevel>0 && <p className="hint-copy">{hintText[hintLevel]}</p>}</div>}
      {verification && <div className="verification-receipt"><ShieldCheck size={18}/><div><strong>Independent challenge selected: {verification.challenge.title}</strong><p>This is a candidate challenge for the same concept. Open Coding Arena and select it from the question list. The attempt is not counted as mastery until it is submitted and evaluated.</p></div></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">SOCRATIC AI TUTOR</div><h3>Think it through</h3><p>Guidance is progressive and does not reveal a full solution by default.</p></div><CircleHelp size={19}/></div>
      <form className="tutor-ask-form" onSubmit={askTutor}><label htmlFor="tutor-mode">Tutor mode</label><select id="tutor-mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="beginner">Beginner — small steps</option><option value="practice">Practice — progressive hints</option><option value="interview">Interview — explain your reasoning</option></select><label htmlFor="tutor-question">What are you stuck on?</label><textarea id="tutor-question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Describe the part you want help reasoning about…" rows={3}/><button className="primary-button" disabled={tutorBusy}>{tutorBusy?'Thinking…':'Ask for guidance'}</button></form>
      {tutor && <div className="tutor-response"><div className="tutor-response-label"><Lightbulb size={15}/> {tutor.provider === 'rule-based-fallback' ? 'Guided fallback' : 'AI Tutor'}</div><p>{tutor.response}</p><span className="mini-muted">Context used: {tutor.evidenceUsed.hasChallenge?'current challenge · ':''}{tutor.evidenceUsed.hasCode?'code context · ':''}{tutor.evidenceUsed.hasCompilerFeedback?'compiler feedback':'available prompt context'}</span></div>}
    </section>
    <div className="table-footnote"><CheckCircle2 size={14}/> Hint requests are learning context, not evidence of low ability. Mastery labels require repeated evidence.</div>
  </div>;
}
