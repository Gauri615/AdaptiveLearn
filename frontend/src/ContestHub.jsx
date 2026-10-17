import React, { useEffect, useState } from 'react';
import { Award, Clock3, Code2, FileCode2, Medal, Play, RefreshCw, Send, ShieldAlert, Trophy } from 'lucide-react';
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

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ContestHub({ notify }) {
  const [contests, setContests] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [contest, setContest] = useState(null);
  const [challengeId, setChallengeId] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadContests = async () => {
    const data = await api('/api/contests');
    setContests(data.contests);
  };

  useEffect(() => {
    loadContests().catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const loadContest = async id => {
    setBusy(true);
    setError('');
    setResult(null);
    setChallenge(null);
    setChallengeId('');
    try {
      const [detail, board] = await Promise.all([
        api(`/api/contests/${id}`),
        api(`/api/contests/${id}/leaderboard`)
      ]);
      setActiveId(String(id));
      setContest(detail.contest);
      setLeaderboard(board.leaderboard);
      if (detail.contest.questions.length) setChallengeId(String(detail.contest.questions[0].challenge_id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!contest?.deadline || !contest.isStarted || contest.isExpired) {
      setRemaining(null);
      return undefined;
    }
    const update = () => setRemaining(Math.max(0, new Date(contest.deadline).getTime() - Date.now()));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [contest?.deadline, contest?.isStarted, contest?.isExpired]);

  useEffect(() => {
    if (!challengeId) return;
    setChallenge(null);
    setResult(null);
    api(`/api/challenges/${challengeId}`)
      .then(data => {
        setChallenge(data.challenge);
        setCode(data.challenge.starter_code);
      })
      .catch(err => setError(err.message));
  }, [challengeId]);

  const startContest = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/contests/${activeId}/start`, { method: 'POST', body: {} });
      await loadContest(activeId);
      notify('Your timed contest has started.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!challenge || !code.trim()) {
      setError('Enter Java code before submitting.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await api(`/api/contests/${activeId}/challenges/${challenge.id}/submit`, {
        method: 'POST',
        body: { code }
      });
      setResult(response.submission);
      const board = await api(`/api/contests/${activeId}/leaderboard`);
      setLeaderboard(board.leaderboard);
      notify(`Contest submission: ${response.submission.status}.`, response.submission.status === 'Accepted' ? 'success' : 'error');
    } catch (err) {
      setError(err.message);
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="panel coding-empty-state">Loading contests…</div>;
  if (!activeId) return <section className="contest-hub">
    <div className="coding-top-strip"><div className="coding-top-icon"><Trophy size={20}/></div><div><strong>Timed contests with server-judged submissions.</strong><span>Choose a contest, start your clock, and solve the included Java challenges.</span></div></div>
    {error && <div className="coding-inline-error" role="alert"><ShieldAlert size={17}/><span>{error}</span></div>}
    {contests.length ? <div className="contest-card-grid">{contests.map(item => <article className="panel contest-card" key={item.id}>
      <div className="contest-card-icon"><Award size={20}/></div><div className="eyebrow">JAVA CONTEST</div><h3>{item.title}</h3><p>{item.description}</p>
      <div className="contest-meta"><span><Clock3 size={14}/>{item.duration_minutes} minutes</span><span><FileCode2 size={14}/>{item.question_count} questions</span><span><Medal size={14}/>{item.participant_count} participants</span></div>
      {item.ends_at && <small className="contest-schedule">Closes {new Date(item.ends_at).toLocaleString()}</small>}
      <button className="primary-button" disabled={busy} onClick={() => loadContest(item.id)}>Open contest <Play size={15}/></button>
    </article>)}</div> : <div className="panel coding-empty-state"><strong>No published contests are open right now.</strong><p>A trainer can publish one from the Trainer cockpit.</p></div>}
  </section>;

  const expired = contest?.isExpired || remaining === 0;
  return <section className="contest-hub">
    <button className="text-button contest-back" onClick={() => { setActiveId(''); setContest(null); setError(''); }}>← All contests</button>
    <div className="contest-detail-grid">
      <div className="contest-main-column">
        <section className="panel contest-overview"><div className="contest-overview-top"><div><div className="eyebrow">TIMED JAVA CONTEST</div><h2>{contest?.title}</h2></div>{contest?.isStarted && <div className={`contest-countdown ${expired ? 'expired' : ''}`}><Clock3 size={18}/><strong>{remaining === null ? 'Complete' : formatTime(remaining)}</strong><span>{expired ? 'Time ended' : 'Time remaining'}</span></div>}</div>
          <p>{contest?.description}</p><div className="contest-overview-meta"><span>{contest?.duration_minutes} minutes</span><span>{contest?.questions?.length} challenges</span>{contest?.ends_at && <span>Contest closes {new Date(contest.ends_at).toLocaleString()}</span>}</div>
          {!contest?.isStarted && <button className="primary-button" disabled={busy} onClick={startContest}><Play size={15}/>{busy ? 'Starting…' : 'Start timed contest'}</button>}
          {contest?.isExpired && <div className="contest-expired-note">This contest attempt has ended. You can still review the leaderboard.</div>}
        </section>
        {contest?.isStarted && <div className="contest-challenge-tabs">{contest.questions.map((question, index) => <button key={question.challenge_id} className={challengeId === String(question.challenge_id) ? 'active' : ''} onClick={() => setChallengeId(String(question.challenge_id))}><span>{String.fromCharCode(65 + index)}</span>{question.title}<small>{question.points} pts</small></button>)}</div>}
        {contest?.isStarted && challenge && <section className="panel contest-editor-panel">
          <div className="contest-problem-brief"><div className="eyebrow">CHALLENGE · {challenge.difficulty.toUpperCase()}</div><h3>{challenge.title}</h3><p>{challenge.prompt}</p></div>
          <div className="editor-toolbar"><div className="editor-file"><span className="java-file-icon">J</span><strong>Main.java</strong><span className="editor-branch">Java 17</span></div><span className="language-pill"><span/>Java</span></div>
          <div className="code-editor coding-source-editor"><div className="line-numbers">{code.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="Contest Java source editor" spellCheck="false" maxLength={30000} value={code} onChange={event => setCode(event.target.value)} disabled={expired}/></div>
          <div className="contest-editor-actions"><span>Hidden tests stay private.</span><button className="primary-button" disabled={busy || expired} onClick={submit}><Send size={15}/>{busy ? 'Submitting…' : 'Submit solution'}</button></div>
          {error && <div className="coding-inline-error" role="alert"><ShieldAlert size={17}/><span>{error}</span></div>}
          {result && <div className={`contest-result ${result.status === 'Accepted' ? 'accepted' : 'failed'}`}><strong>{result.status}</strong><span>{result.testsPassed}/{result.totalTests} tests · {result.passPercentage}% · {result.executionTimeMs} ms</span></div>}
        </section>}
        {contest?.isStarted && !challenge && <div className="panel coding-empty-state"><strong>No questions are attached to this contest.</strong></div>}
      </div>
      <aside className="panel contest-leaderboard"><div className="panel-heading"><div><div className="eyebrow">LIVE STANDINGS</div><h3><Trophy size={17}/> Leaderboard</h3></div><button className="icon-button" aria-label="Refresh leaderboard" onClick={() => loadContest(activeId)}><RefreshCw size={15}/></button></div>
        {leaderboard.length ? <ol>{leaderboard.map((entry, index) => <li key={entry.user_id}><span className="leaderboard-rank">{index + 1}</span><span className="leaderboard-name">{entry.user_name}</span><strong>{entry.score}</strong></li>)}</ol> : <div className="contest-board-empty">No submissions yet. Start solving to appear here.</div>}
      </aside>
    </div>
  </section>;
}
