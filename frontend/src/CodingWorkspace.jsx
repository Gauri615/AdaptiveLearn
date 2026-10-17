import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FileCode2, History, Lightbulb, MessageSquareText, Play, RefreshCw, RotateCcw, Send, ShieldAlert, Terminal, Trash2, XCircle } from 'lucide-react';
import './coding.css';

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

const statusTone = status => status === 'Accepted' || status === 'Public Samples Passed' || status === 'passed' ? 'accepted' : status === 'Wrong Answer' || status === 'wrong_answer' || status === 'Compilation Error' || status === 'compilation_error' ? 'failed' : 'neutral';

export default function CodingWorkspace({ notify, user }) {
  const [challenges, setChallenges] = useState([]);
  const [challengeId, setChallengeId] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [prediction, setPrediction] = useState('');
  const [confidence, setConfidence] = useState('3');
  const [showMutation, setShowMutation] = useState(false);
  const [sessionKey, setSessionKey] = useState(() => `editor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const debounce = useRef(null);

  const loadHistory = async id => {
    const data = await api(`/api/submissions/history?challengeId=${id}`);
    setHistory(data.submissions);
  };

  useEffect(() => {
    api('/api/challenges')
      .then(data => {
        setChallenges(data.challenges);
        if (data.challenges.length) setChallengeId(String(data.challenges[0].id));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!challengeId) return;
    setError('');
    setChallenge(null);
    setResult(null);
    Promise.all([
      api(`/api/challenges/${challengeId}`),
      loadHistory(challengeId)
    ]).then(([data]) => {
      setChallenge(data.challenge);
      setCode(data.challenge.starter_code);
      setResult(null);
      setPrediction('');
      setConfidence('3');
      setShowMutation(false);
      setSessionKey(`editor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    }).catch(err => setError(err.message));
  }, [challengeId]);

  useEffect(() => () => window.clearTimeout(debounce.current), []);

  const logEvent = async (eventType, payload = {}, snapshotCode = null, snapshotLabel = 'Editor snapshot') => {
    try {
      await api('/api/editor/events', {
        method: 'POST',
        body: { challengeId: Number(challengeId), sessionKey, eventType, payload, snapshotCode, snapshotLabel }
      });
      return true;
    } catch {
      notify('Code execution is available, but the learning timeline could not be updated.', 'error');
      return false;
    }
  };

  const updateCode = value => {
    setCode(value);
    setResult(null);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => logEvent('code_change', { length: value.length, source: 'editor' }), 650);
  };

  const execute = async mode => {
    if (!challenge) return;
    if (mode === 'submit' && prediction.trim().length < 3) {
      notify('Before submitting, write a short prediction of the expected behaviour.', 'error');
      return;
    }
    setWorking(mode);
    setError('');
    setResult(null);
    try {
      if (mode === 'submit') {
        await logEvent('snapshot', { length: code.length, reason: 'submission' }, code, 'Before submission');
        await logEvent('submit_clicked', { length: code.length });
        await logEvent('code_change', { kind: 'predict_before_run', prediction: prediction.slice(0, 500), confidence: Number(confidence) });
      } else {
        await logEvent('run_clicked', { length: code.length, action: 'public_samples' });
      }
      const data = await api(`/api/challenges/${challenge.id}/${mode}`, {
        method: 'POST',
        body: { code, sessionKey }
      });
      setResult({ mode, ...(mode === 'run' ? data.result : data.submission) });
      if (mode === 'submit') await loadHistory(challenge.id);
      const outcome = mode === 'run' ? data.result.status : data.submission.status;
      notify(mode === 'run' ? `Public sample execution: ${outcome}.` : `Submission recorded: ${outcome}.`, ['Accepted', 'Public Samples Passed'].includes(outcome) ? 'success' : 'error');
    } catch (err) {
      setError(err.message);
      notify(err.message, 'error');
    } finally {
      setWorking('');
    }
  };

  const resetCode = () => {
    setCode(challenge?.starter_code || '');
    setResult(null);
    setError('');
  };
  const saveCheckpoint = async () => {
    const saved = await logEvent('snapshot', { length: code.length, reason: 'manual checkpoint' }, code, 'Manual checkpoint');
    if (saved) notify('Code checkpoint saved to your Code Time Machine.');
  };

  if (loading) return <div className="panel coding-empty-state">Loading Java challenges…</div>;
  if (error && !challenge) return <div className="panel coding-empty-state coding-error"><strong>Could not load the Coding Arena</strong><p>{error}</p><button className="ghost-button" onClick={() => window.location.reload()}><RefreshCw size={15}/> Retry</button></div>;
  if (!challenges.length) return <div className="panel coding-empty-state"><strong>No published Java questions yet.</strong><p>A trainer can publish a question from the Trainer cockpit.</p></div>;

  const status = result?.status || '';
  const results = result?.publicResults || [];
  const passed = result?.testsPassed ?? result?.passedCount ?? 0;
  const total = result?.totalTests ?? result?.totalCount ?? 0;

  return <>
    <div className="coding-top-strip">
      <div className="coding-top-icon"><Terminal size={20}/></div>
      <div><strong>Java runs in an isolated sandbox.</strong><span>Run checks public samples; submit evaluates private tests server-side.</span></div>
      <span className="execution-limit"><ShieldAlert size={14}/> {challenge?.time_limit_ms} ms · {challenge?.memory_limit_mb} MB</span>
    </div>
    <div className="coding-workspace-layout">
      <aside className="panel coding-problem-panel">
        <div className="coding-panel-head"><div><div className="eyebrow">PROBLEM</div><h3>Choose a challenge</h3></div><span className="small-tag">JAVA</span></div>
        <div className="challenge-list">{challenges.map(item => <button key={item.id} className={`challenge-item ${String(item.id) === challengeId ? 'active' : ''}`} onClick={() => setChallengeId(String(item.id))}><div className="challenge-icon"><FileCode2 size={18}/></div><div><strong>{item.title}</strong><span>{item.concept_title} · {item.estimated_minutes} min</span></div><span className={`difficulty-pill ${item.difficulty.toLowerCase()}`}>{item.difficulty}</span></button>)}</div>
        {challenge && <div className="challenge-brief"><div className="eyebrow">PROBLEM STATEMENT</div><h3>{challenge.title}</h3><p>{challenge.prompt}</p><div className="brief-tip"><Clock3 size={15}/><span>{challenge.marks} marks · {challenge.public_tests.length} public samples</span></div>{challenge.hints?.length > 0 && <details className="coding-hints"><summary>Hints ({challenge.hints.length})</summary><ol>{challenge.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ol></details>}</div>}
        {challenge && <div className="sample-tests"><div className="eyebrow">PUBLIC SAMPLE CASES</div>{challenge.public_tests.map((test, index) => <details key={test.id} className="sample-case"><summary>Sample {index + 1}</summary><span>Input</span><pre>{test.input || '(empty input)'}</pre><span>Expected output</span><pre>{test.expectedOutput || '(empty output)'}</pre></details>)}</div>}
      </aside>
      <section className="panel coding-editor-panel">
        <div className="editor-toolbar"><div className="editor-file"><span className="java-file-icon">J</span><strong>Main.java</strong><span className="editor-branch">Java 17</span></div><div className="editor-toolbar-actions"><span className="language-pill"><span/>Java</span></div></div>
        <div className="editor-info"><span><span className="editor-live"/> Ready</span><span>{code.length.toLocaleString()} / 30,000 characters</span><span>Changes are not saved until submission</span></div>
        <div className="code-editor coding-source-editor"><div className="line-numbers">{code.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="Java source code editor" spellCheck="false" maxLength={30000} value={code} onChange={event => updateCode(event.target.value)} onFocus={() => logEvent('editor_focus')} onBlur={() => logEvent('editor_blur')}/></div>
        <div className="predict-panel coding-reflection-panel"><div className="predict-panel-heading"><div><span className="eyebrow">PREDICT BEFORE SUBMIT</span><h4>What should your code do?</h4></div><span className="small-tag">REFLECTION</span></div><textarea rows={2} maxLength={500} value={prediction} onChange={event => setPrediction(event.target.value)} placeholder="Describe the expected output or an edge case…"/><div className="confidence-row"><label htmlFor="coding-confidence">Confidence</label><select id="coding-confidence" value={confidence} onChange={event => setConfidence(event.target.value)}><option value="1">1 · Guessing</option><option value="2">2 · A little</option><option value="3">3 · Somewhat</option><option value="4">4 · Confident</option><option value="5">5 · Very confident</option></select><button type="button" className="text-button" onClick={() => setShowMutation(value => !value)}>{showMutation ? 'Hide mutation' : 'Try a mutation'}</button></div>{showMutation && <div className="mutation-callout"><strong>Mutation challenge</strong><p>Change one input or boundary condition and predict how the output should change. Save a checkpoint to compare your edits later.</p></div>}</div>
        <div className="coding-action-row"><button className="ghost-button" disabled={Boolean(working)} onClick={resetCode}><RotateCcw size={15}/> Reset code</button><button className="ghost-button" disabled={Boolean(working)} onClick={saveCheckpoint}><History size={15}/> Save checkpoint</button><span className="coding-action-spacer"/><button className="ghost-button" disabled={Boolean(working)} onClick={() => execute('run')}><Play size={15}/>{working === 'run' ? 'Running…' : 'Run public samples'}</button><button className="primary-button" disabled={Boolean(working)} onClick={() => execute('submit')}><Send size={15}/>{working === 'submit' ? 'Submitting…' : 'Submit solution'}</button></div>
        {error && <div className="coding-inline-error" role="alert"><ShieldAlert size={17}/><span>{error}</span></div>}
        {result && <div className="coding-result-panel">
          <div className={`coding-result-heading ${statusTone(status)}`}><div>{['Accepted', 'Public Samples Passed'].includes(status) ? <CheckCircle2 size={21}/> : ['Compilation Error','Runtime Error','Time Limit Exceeded','Internal Execution Error'].includes(status) ? <XCircle size={21}/> : <Terminal size={21}/>}</div><div><strong>{status}</strong><span>{result.mode === 'submit' ? `${passed}/${total} tests passed · ${result.passPercentage}%` : `${passed}/${total} public samples passed · hidden tests not assessed`}</span></div><span className="execution-time">{result.executionTimeMs ?? 0} ms</span></div>
          {result.compilationStatus === 'failed' && <div className="execution-detail"><strong>Compilation error</strong><pre>{results.find(test => test.stderr)?.stderr || result.feedback || 'Compilation failed. Review the Java compiler output from public tests.'}</pre></div>}
          {result.executionStatus === 'runtime_error' && <div className="execution-detail"><strong>Runtime error</strong><p>The program exited unexpectedly while running a public sample.</p></div>}
          {results.length > 0 && <div className="coding-test-result-list">{results.map(test => <details className="coding-test-result" key={`${test.index}-${test.status}`}><summary><span className={test.passed ? 'test-pass-icon' : 'test-fail-icon'}>{test.passed ? <CheckCircle2 size={16}/> : <XCircle size={16}/>}</span><strong>Test {test.index}</strong><span>{test.status}</span><small>{test.executionTimeMs} ms</small></summary><div className="execution-detail"><b>Input</b><pre>{test.input || '(empty)'}</pre><b>Expected</b><pre>{test.expectedOutput || '(empty)'}</pre><b>Standard output</b><pre>{test.actualOutput || '(empty)'}</pre>{test.stderr && <><b>Standard error</b><pre>{test.stderr}</pre></>}</div></details>)}</div>}
        </div>}
      </section>
    </div>
    <ChallengeDiscussion key={challenge?.id} challengeId={challenge?.id} user={user}/>
    <section className="panel submission-history-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR RECORD</div><h3><History size={17}/> Submission history</h3></div><span className="small-tag">{history.length} RECENT</span></div>{history.length ? <div className="coding-history-list">{history.map(item => <div key={item.id} className="coding-history-row"><strong>#{item.id}</strong><span>{item.status}</span><span>{item.tests_passed}/{item.total_tests} tests · {item.pass_percentage}%</span><time>{new Date(item.created_at).toLocaleString()}</time></div>)}</div> : <p className="mini-muted">Your submitted solutions will appear here.</p>}</section>
  </>;
}

function ChallengeDiscussion({ challengeId, user }) {
  const [posts, setPosts] = useState([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!challengeId) return;
    const data = await api(`/api/challenges/${challengeId}/discussions`);
    setPosts(data.posts);
  };

  useEffect(() => { load().catch(err => setError(err.message)); }, [challengeId]);

  const post = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/challenges/${challengeId}/discussions`, {
        method: 'POST',
        body: { body, parentId: replyTo }
      });
      setBody('');
      setReplyTo(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async id => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/discussions/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel challenge-discussion">
    <div className="panel-heading"><div><div className="eyebrow">LEARN TOGETHER</div><h3><MessageSquareText size={17}/> Challenge discussion</h3><p>Ask questions or share an approach. Keep hidden test data private.</p></div><span className="small-tag">{posts.length} POSTS</span></div>
    {error && <div className="coding-inline-error" role="alert"><ShieldAlert size={16}/><span>{error}</span></div>}
    <form className="discussion-compose" onSubmit={post}>
      {replyTo && <div className="discussion-replying">Replying to a post <button type="button" onClick={() => setReplyTo(null)}>Cancel</button></div>}
      <textarea required minLength={2} maxLength={3000} rows={3} value={body} onChange={event => setBody(event.target.value)} placeholder="Ask about an idea, edge case, or Java concept…"/>
      <div><span>{body.length}/3,000</span><button className="primary-button" disabled={busy || !challengeId}><Send size={14}/>{busy ? 'Posting…' : 'Post'}</button></div>
    </form>
    <div className="discussion-post-list">{posts.length ? posts.map(item => <article className={`discussion-post ${item.parent_id ? 'discussion-reply' : ''}`} key={item.id}>
      <div className="discussion-post-top"><div><strong>{item.author_name}</strong><span>{item.author_role === 'trainer' ? 'Trainer' : 'Learner'} · {new Date(item.created_at).toLocaleString()}</span></div><div>
        <button className="text-button" disabled={busy} onClick={() => { setReplyTo(item.id); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}>Reply</button>
        {(Number(item.user_id) === Number(user?.id) || user?.role === 'trainer') && <button className="icon-button subtle" disabled={busy} aria-label="Remove discussion post" onClick={() => remove(item.id)}><Trash2 size={14}/></button>}
      </div></div><p>{item.body}</p>
    </article>) : <p className="mini-muted">No posts yet. Start a useful discussion about this challenge.</p>}</div>
  </section>;
}
