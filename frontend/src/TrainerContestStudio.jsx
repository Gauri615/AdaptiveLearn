import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trophy } from 'lucide-react';
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

export default function TrainerContestStudio({ notify }) {
  const [challenges, setChallenges] = useState([]);
  const [contests, setContests] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [selected, setSelected] = useState({});
  const [points, setPoints] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [options, owned] = await Promise.all([
      api('/api/trainer/contest-options'),
      api('/api/trainer/contests')
    ]);
    setChallenges(options.challenges);
    setContests(owned.contests);
    setPoints(current => Object.fromEntries(options.challenges.map(item => [item.id, current[item.id] || '100'])));
  };

  useEffect(() => { load().catch(err => setError(err.message)); }, []);

  const toggle = id => setSelected(current => ({ ...current, [id]: !current[id] }));
  const create = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const questions = challenges.filter(item => selected[item.id]).map(item => ({
        challengeId: Number(item.id),
        points: Number(points[item.id] || 100)
      }));
      await api('/api/trainer/contests', {
        method: 'POST',
        body: {
          title,
          description,
          durationMinutes: Number(durationMinutes),
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          questions
        }
      });
      setTitle('');
      setDescription('');
      setDurationMinutes('60');
      setStartsAt('');
      setEndsAt('');
      setSelected({});
      await load();
      notify('Contest published for students.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel trainer-coding-studio trainer-contest-studio">
    <div className="panel-heading"><div><div className="eyebrow">CONTEST DESIGNER</div><h3>Create timed coding contests</h3><p>Contests are published immediately and use hidden tests from your eligible questions.</p></div><span className="small-tag">TRAINER ONLY</span></div>
    {error && <div className="studio-error" role="alert">{error}</div>}
    <div className="trainer-question-browser"><div className="author-test-heading"><div><strong>Your contests</strong><span>Manage participation through the Contests navigation.</span></div><Trophy size={17}/></div>
      {contests.length ? contests.map(item => <div className="trainer-question-row" key={item.id}><div><strong>{item.title}</strong><span>{item.duration_minutes} minutes · {item.question_count} questions{item.starts_at ? ` · starts ${new Date(item.starts_at).toLocaleString()}` : ''}</span></div><span className={`question-state ${item.status === 'published' ? 'published' : 'draft'}`}>{item.status}</span></div>) : <p className="contest-board-empty">No contests created yet.</p>}
    </div>
    <form className="studio-form trainer-java-form" onSubmit={create}>
      <div className="trainer-form-title"><Plus size={18}/><strong>Contest details</strong></div>
      <label>Contest title<input required minLength={4} maxLength={180} value={title} onChange={event => setTitle(event.target.value)}/></label>
      <label>Instructions<textarea required minLength={10} maxLength={5000} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Explain contest rules and expectations."/></label>
      <div className="contest-form-grid">
        <label>Duration (minutes)<input type="number" min="5" max="300" required value={durationMinutes} onChange={event => setDurationMinutes(event.target.value)}/></label>
        <label><CalendarClock size={14}/> Opens at (optional)<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)}/></label>
        <label><CalendarClock size={14}/> Closes at (optional)<input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)}/></label>
      </div>
      <fieldset className="contest-question-picker"><legend>Choose published questions with hidden tests</legend>
        {challenges.length ? challenges.map(item => <div className="contest-question-option" key={item.id}>
          <label><input type="checkbox" checked={Boolean(selected[item.id])} onChange={() => toggle(item.id)}/><span><strong>{item.title}</strong><small>{item.difficulty}</small></span></label>
          <label>Points<input type="number" min="1" max="10000" value={points[item.id] || '100'} onChange={event => setPoints(current => ({ ...current, [item.id]: event.target.value }))}/></label>
        </div>) : <p>Publish a coding question with at least one hidden test before creating a contest.</p>}
      </fieldset>
      <button className="primary-button" disabled={busy || !challenges.length}>{busy ? 'Publishing…' : 'Publish contest'} <Trophy size={15}/></button>
    </form>
  </section>;
}
