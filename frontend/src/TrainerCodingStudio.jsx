import React, { useEffect, useMemo, useState } from 'react';
import { Code2, Plus, Save, Trash2 } from 'lucide-react';
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

const emptyTest = () => ({ input: '', expectedOutput: '', comparison: 'trim' });
const emptyQuestion = conceptId => ({
  conceptId: String(conceptId || ''), title: '', difficulty: 'Easy', prompt: '',
  starterCode: 'public class Main {\n    public static void main(String[] args) {\n        // Read input and print the required output\n    }\n}',
  minutes: 20, timeLimitMs: 2000, memoryLimitMb: 256, marks: 100, status: 'draft',
  hints: [], tagConceptIds: [], prerequisiteConceptIds: [],
  publicTests: [emptyTest()], hiddenTests: [emptyTest()]
});

export default function TrainerCodingStudio({ notify }) {
  const [concepts, setConcepts] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState(emptyQuestion());
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const availablePrerequisites = useMemo(() => concepts.filter(concept => String(concept.id) !== question.conceptId), [concepts, question.conceptId]);

  const load = async () => {
    const [conceptData, questionData] = await Promise.all([
      api('/api/trainer/concepts'),
      api('/api/trainer/coding-questions')
    ]);
    setConcepts(conceptData.concepts);
    setQuestions(questionData.questions);
    setQuestion(current => current.conceptId ? current : emptyQuestion(conceptData.concepts[0]?.id));
  };

  useEffect(() => { load().catch(err => setError(err.message)); }, []);

  const toggleConcept = (key, id) => setQuestion(current => {
    const selected = current[key].map(Number);
    const next = selected.includes(Number(id)) ? selected.filter(value => value !== Number(id)) : [...selected, Number(id)];
    return { ...current, [key]: next };
  });
  const updateTest = (category, index, field, value) => setQuestion(current => ({
    ...current,
    [category]: current[category].map((test, testIndex) => testIndex === index ? { ...test, [field]: value } : test)
  }));
  const addTest = category => setQuestion(current => ({ ...current, [category]: [...current[category], emptyTest()] }));
  const removeTest = (category, index) => setQuestion(current => ({ ...current, [category]: current[category].filter((_, testIndex) => testIndex !== index) }));

  const editQuestion = async id => {
    setBusy(true);
    setError('');
    try {
      const { question: saved } = await api(`/api/trainer/challenges/${id}`);
      setQuestion({ ...saved, conceptId: String(saved.conceptId), publicTests: saved.publicTests.map(test => ({ input: test.input, expectedOutput: test.expectedOutput, comparison: test.comparison })), hiddenTests: saved.hiddenTests.map(test => ({ input: test.input, expectedOutput: test.expectedOutput, comparison: test.comparison })) });
      setEditingId(id);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const clearQuestion = () => {
    setEditingId(null);
    setQuestion(emptyQuestion(concepts[0]?.id));
    setError('');
  };

  const saveQuestion = async (event, status) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const payload = { ...question, conceptId: Number(question.conceptId), status, hints: typeof question.hints === 'string' ? question.hints.split('\n').map(item => item.trim()).filter(Boolean) : question.hints };
    try {
      const path = editingId ? `/api/trainer/challenges/${editingId}` : '/api/trainer/challenges';
      await api(path, { method: editingId ? 'PUT' : 'POST', body: payload });
      await load();
      notify(status === 'published' ? 'Coding question published.' : 'Draft saved.');
      clearQuestion();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const deleteQuestion = async id => {
    if (!window.confirm('Delete this coding question and its test cases?')) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/trainer/challenges/${id}`, { method: 'DELETE' });
      await load();
      if (editingId === id) clearQuestion();
      notify('Coding question deleted.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const renderCases = (category, title) => <section className="author-test-section"><div className="author-test-heading"><div><strong>{title}</strong><span>{question[category].length} cases</span></div><button type="button" className="ghost-button" disabled={question.publicTests.length + question.hiddenTests.length >= 20} onClick={() => addTest(category)}><Plus size={14}/> Add case</button></div>{question[category].map((test, index) => <div className="author-test-card" key={`${category}-${index}`}><div className="author-test-card-head"><strong>Case {index + 1}</strong><button type="button" className="icon-button subtle" aria-label={`Remove ${title} case ${index + 1}`} disabled={question[category].length <= 1} onClick={() => removeTest(category, index)}><Trash2 size={15}/></button></div><label>Input<textarea rows={2} value={test.input} onChange={event => updateTest(category, index, 'input', event.target.value)}/></label><label>Expected output<textarea rows={2} value={test.expectedOutput} onChange={event => updateTest(category, index, 'expectedOutput', event.target.value)}/></label><label>Comparison<select value={test.comparison} onChange={event => updateTest(category, index, 'comparison', event.target.value)}><option value="trim">Trim outer whitespace</option><option value="exact">Exact match</option><option value="tokens">Whitespace-insensitive tokens</option></select></label></div>)}</section>;

  return <section className="panel trainer-coding-studio">
    <div className="panel-heading"><div><div className="eyebrow">JAVA QUESTION DESIGNER</div><h3>Create assessed coding missions</h3><p>Hidden inputs and expected outputs are stored server-side and never sent to students.</p></div><span className="small-tag">TRAINER ONLY</span></div>
    {error && <div className="studio-error" role="alert">{error}</div>}
    <div className="trainer-question-browser"><div className="author-test-heading"><div><strong>Your coding questions</strong><span>Drafts are private; published questions are available to students.</span></div><button type="button" className="ghost-button" onClick={clearQuestion}><Plus size={14}/> New question</button></div>{questions.map(item => <div className="trainer-question-row" key={item.id}><div><strong>{item.title}</strong><span>{item.concept_title} · {item.public_test_count} public · {item.hidden_test_count} hidden</span></div><span className={`question-state ${item.status}`}>{item.status}</span><button type="button" className="ghost-button" disabled={busy} onClick={() => editQuestion(item.id)}>Edit</button><button type="button" className="icon-button subtle" disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => deleteQuestion(item.id)}><Trash2 size={15}/></button></div>)}</div>
    <form className="studio-form trainer-java-form" onSubmit={event => saveQuestion(event, question.status)}>
      <div className="trainer-form-title"><Code2 size={18}/><strong>{editingId ? `Edit question #${editingId}` : 'Question details'}</strong></div>
      <label>Question title<input required minLength={4} maxLength={180} value={question.title} onChange={event => setQuestion({ ...question, title: event.target.value })}/></label>
      <label>Primary concept<select required value={question.conceptId} onChange={event => setQuestion({ ...question, conceptId: event.target.value })}><option value="">Choose a concept</option>{concepts.map(concept => <option key={concept.id} value={concept.id}>{concept.title}</option>)}</select></label>
      <label>Difficulty<select value={question.difficulty} onChange={event => setQuestion({ ...question, difficulty: event.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
      <label>Estimated minutes<input type="number" min="5" max="120" value={question.minutes} onChange={event => setQuestion({ ...question, minutes: event.target.value })}/></label>
      <label className="studio-wide">Problem statement<textarea required minLength={12} maxLength={12000} rows={4} value={question.prompt} onChange={event => setQuestion({ ...question, prompt: event.target.value })}/></label>
      <label className="studio-wide">Starter Java source<textarea className="studio-code" required maxLength={30000} rows={10} value={question.starterCode} onChange={event => setQuestion({ ...question, starterCode: event.target.value })}/></label>
      <div className="studio-wide author-concept-grid"><fieldset><legend>Concept tags</legend>{concepts.map(concept => <label key={concept.id}><input type="checkbox" checked={Number(concept.id) === Number(question.conceptId) || question.tagConceptIds.map(Number).includes(Number(concept.id))} disabled={Number(concept.id) === Number(question.conceptId)} onChange={() => toggleConcept('tagConceptIds', concept.id)}/>{concept.title}</label>)}</fieldset><fieldset><legend>Prerequisite concepts</legend>{availablePrerequisites.map(concept => <label key={concept.id}><input type="checkbox" checked={question.prerequisiteConceptIds.map(Number).includes(Number(concept.id))} onChange={() => toggleConcept('prerequisiteConceptIds', concept.id)}/>{concept.title}</label>)}</fieldset></div>
      <label>Time limit (ms)<input type="number" min="500" max="3000" value={question.timeLimitMs} onChange={event => setQuestion({ ...question, timeLimitMs: event.target.value })}/></label>
      <label>Memory limit (MB)<input type="number" min="256" max="512" step="64" value={question.memoryLimitMb} onChange={event => setQuestion({ ...question, memoryLimitMb: event.target.value })}/></label>
      <label>Marks<input type="number" min="1" max="1000" value={question.marks} onChange={event => setQuestion({ ...question, marks: event.target.value })}/></label>
      <label className="studio-wide">Hints<textarea rows={3} placeholder="One hint per line" value={Array.isArray(question.hints) ? question.hints.join('\n') : question.hints} onChange={event => setQuestion({ ...question, hints: event.target.value })}/></label>
      {renderCases('publicTests', 'Public test cases')}
      {renderCases('hiddenTests', 'Hidden test cases')}
      <div className="studio-footer"><span>Published questions require at least one public and one hidden case.</span><div className="trainer-save-actions"><button type="button" className="ghost-button" disabled={busy} onClick={event => saveQuestion(event, 'draft')}><Save size={14}/> {busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="primary-button" disabled={busy || !concepts.length} onClick={event => saveQuestion(event, 'published')}>{busy ? 'Saving…' : 'Publish question'}</button></div></div>
    </form>
  </section>;
}
