import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import './styles.css';
import './modules.css';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api', withCredentials: true });

function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Cannot connect to the server. Check that the API is running and try again.';
    const data = error.response.data as { error?: { message?: string }; message?: string } | undefined;
    return data?.error?.message || data?.message || `Request failed (${error.response.status}). Please try again.`;
  }
  return error instanceof Error ? error.message : fallback;
}

function ErrorNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return <div className="error-notice" role="alert"><span>{message}</span>{onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss error">Dismiss</button>}</div>;
}

const Head = ({ k, t }: { k: string; t: string }) => <header><div><p className="eyebrow">{k}</p><h2>{t}</h2></div><nav><Link to="/radar">Radar</Link> · <Link to="/arena">Arena</Link> · <Link to="/replay">Time Machine</Link> · <Link to="/viva">Viva</Link></nav></header>;

function Radar() {
  const [recommendation, setRecommendation] = useState<any>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const courses = await api.get('/courses');
        const courseId = courses.data?.courses?.[0]?.id;
        if (!courseId) { if (active) setRecommendation({ evidence: 'No course is available yet. Ask a trainer to create or seed a course.' }); return; }
        const response = await api.get(`/learning/path/${courseId}`);
        if (active) setRecommendation(response.data?.recommendation || { evidence: 'No recommendation is available yet.' });
      } catch (e) { if (active) setError(errorMessage(e, 'Unable to load recommendations.')); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  return <><Head k="MODULE 3" t="Knowledge Gap Radar"/><section className="panel"><ErrorNotice message={error}/>{loading ? <p>Loading recommendations…</p> : <><h3>{recommendation?.recommended?.title || 'Evidence pending'}</h3><p>{recommendation?.evidence}</p><p>{recommendation?.condition}</p></>}</section></>;
}

function Arena() {
  const [problem, setProblem] = useState<any>();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    api.get('/learning/problems').then(response => {
      const item = response.data?.problems?.[0];
      if (active) { setProblem(item); setCode(item?.starter_code || ''); if (!item) setError('No reviewed exercise is available right now.'); }
    }).catch(e => { if (active) setError(errorMessage(e, 'Unable to load exercises.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const submit = async () => {
    if (!problem?.id) { setError('Choose an available exercise before submitting.'); return; }
    setSubmitting(true); setError(''); setResult(undefined);
    try {
      const session = await api.post('/learning/sessions', { problemId: problem.id });
      await api.post(`/learning/sessions/${session.data.sessionId}/events`, { type: 'submit', after: code });
      const response = await api.post('/learning/submissions', { problemId: problem.id, sessionId: session.data.sessionId, language: 'java', code });
      localStorage.setItem('lastSubmission', response.data.submissionId);
      setResult(response.data);
    } catch (e) { setError(errorMessage(e, 'Submission failed. Your code is still in the editor; please try again.')); }
    finally { setSubmitting(false); }
  };
  return <><Head k="MODULE 4 · DEVELOPMENT MODE" t="Mutation Arena"/><section className="panel"><ErrorNotice message={error} onDismiss={() => setError('')}/>{loading ? <p>Loading exercise…</p> : <><p>{problem?.prompt || 'There is no exercise to display.'}</p><textarea className="editor" value={code} onChange={e => setCode(e.target.value)} disabled={!problem || submitting} aria-label="Code editor"/><button onClick={submit} disabled={!problem || submitting}>{submitting ? 'Submitting…' : 'Submit reviewed check'}</button></>}{result && <p className="result" role="status">{result.status} · {result.score}% — {result.message}</p>}</section></>;
}

function Replay() {
  const [id, setId] = useState(() => localStorage.getItem('lastSubmission') || '');
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!id.trim()) { setError('Enter a submission ID first.'); return; }
    setLoading(true); setError(''); setData(undefined);
    try { const response = await api.get(`/learning/submissions/${encodeURIComponent(id.trim())}/replay`); setData(response.data); }
    catch (e) { setError(errorMessage(e, 'Unable to load replay.')); }
    finally { setLoading(false); }
  };
  return <><Head k="MODULE 5" t="Code Time Machine"/><section className="panel"><ErrorNotice message={error} onDismiss={() => setError('')}/><input value={id} onChange={e => setId(e.target.value)} placeholder="Submission ID" aria-label="Submission ID"/><button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Load replay'}</button>{data && (data.events?.length ? data.events.map((event: any) => <article className="event" key={event.id}><b>{event.event_type}</b> <small>{event.occurred_at}</small><pre>{event.code_after || '(No code snapshot for this event)'}</pre></article>) : <p>No replay events were recorded for this submission.</p>)}</section></>;
}

function Viva() {
  const [id, setId] = useState(() => localStorage.getItem('lastSubmission') || '');
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const load = async () => {
    if (!id.trim()) { setError('Enter a submission ID first.'); return; }
    setLoading(true); setError(''); setQuestions([]); setResult(undefined);
    try { const response = await api.get(`/learning/submissions/${encodeURIComponent(id.trim())}/viva`); setQuestions(response.data?.questions || []); if (!response.data?.questions?.length) setError('No viva questions are available for this submission.'); }
    catch (e) { setError(errorMessage(e, 'Unable to load viva questions.')); }
    finally { setLoading(false); }
  };
  const verify = async (questionId: string) => {
    const explanation = answers[questionId]?.trim();
    if (!explanation) { setError('Add an explanation before verifying your answer.'); return; }
    setVerifying(questionId); setError(''); setResult(undefined);
    try { const response = await api.post(`/learning/viva/${encodeURIComponent(questionId)}`, { explanation }); setResult(response.data); }
    catch (e) { setError(errorMessage(e, 'Unable to verify this answer.')); }
    finally { setVerifying(null); }
  };
  return <><Head k="MODULE 6" t="Code Twin Viva"/><section className="panel"><ErrorNotice message={error} onDismiss={() => setError('')}/><input value={id} onChange={e => setId(e.target.value)} placeholder="Submission ID" aria-label="Submission ID"/><button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Load questions'}</button>{questions.map(question => <div className="viva" key={question.id}><pre>{question.excerpt}</pre><h3>{question.question}</h3><p>{question.modification}</p><textarea value={answers[question.id] || ''} onChange={e => setAnswers(previous => ({ ...previous, [question.id]: e.target.value }))} placeholder="Explain the change" aria-label="Explain the code change"/><button onClick={() => verify(String(question.id))} disabled={verifying === String(question.id)}>{verifying === String(question.id) ? 'Verifying…' : 'Verify'}</button></div>)}{result && <p className="result" role="status">{result.evaluation}: {result.rationale}</p>}</section></>;
}

function Home() {
  return <><Head k="ADAPTIVELEARN" t="Evidence-based learning loop"/><section className="grid"><div className="card"><strong>Radar</strong><span>Prerequisite-aware, explainable recommendations</span></div><div className="card"><strong>Arena</strong><span>Reviewed development checks; no arbitrary execution</span></div><div className="card"><strong>Replay + Viva</strong><span>Editor-only evidence and code-linked explanation</span></div></section></>;
}

function NotFound() { return <section className="panel"><h2>Page not found</h2><p>This page does not exist or may have moved.</p><Link to="/">Return home</Link></section>; }

createRoot(document.getElementById('root')!).render(<BrowserRouter><main><Routes><Route path="/" element={<Home/>}/><Route path="/radar" element={<Radar/>}/><Route path="/arena" element={<Arena/>}/><Route path="/replay" element={<Replay/>}/><Route path="/viva" element={<Viva/>}/><Route path="*" element={<NotFound/>}/></Routes></main></BrowserRouter>);
