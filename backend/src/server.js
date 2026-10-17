import express from 'express';
import cors from 'cors';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, query } from './db.js';
import { createCodingRouter } from './codingRoutes.js';
import { javaSandboxStatus } from './javaSandbox.js';
import { createAdaptiveRouter } from './adaptiveRoutes.js';

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'adaptix.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
}));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
const requireTrainer = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (req.session.user.role !== 'trainer') return res.status(403).json({ error: 'Trainer access is required.' });
  next();
};
const jsonArray = (value) => Array.isArray(value) ? value : (typeof value === 'string' ? JSON.parse(value || '[]') : []);

app.use('/api', createCodingRouter({ requireAuth, requireTrainer }));
app.use('/api', createAdaptiveRouter({ requireAuth, requireTrainer }));

app.get('/api/health', asyncRoute(async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'ADAPTIX AI API',
      database: 'connected',
      databaseName: process.env.DB_NAME || 'adaptix_ai',
      javaExecution: await javaSandboxStatus()
    });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'ADAPTIX AI API', database: 'disconnected', error: 'MySQL is not reachable. Start MySQL in XAMPP and import backend/sql/schema.sql.' });
  }
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
  }
  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'An account with this email already exists.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)', [name, email, passwordHash, 'student']);
  req.session.user = { id: result.insertId, name, email, role: 'student' };
  const concepts = await query('SELECT id FROM concepts');
  for (const c of concepts) await query('INSERT IGNORE INTO student_concept_mastery (user_id,concept_id) VALUES (?,?)', [result.insertId, c.id]);
  res.status(201).json({ user: publicUser(req.session.user) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const rows = await query('SELECT id,name,email,password_hash,role FROM users WHERE email = ?', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a secure session. Please try again.' });
    req.session.user = publicUser(rows[0]);
    req.session.save((saveErr) => saveErr ? res.status(500).json({ error: 'Could not save session.' }) : res.json({ user: req.session.user }));
  });
}));

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('adaptix.sid'); res.json({ ok: true }); }));
app.get('/api/auth/me', (req, res) => req.session.user ? res.json({ user: req.session.user }) : res.status(401).json({ error: 'Not signed in.' }));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const userId = req.session.user.id;
  const [mastery, answers, submissions, recommendation] = await Promise.all([
    query(`SELECT c.id,c.title,c.slug,c.order_index,COALESCE(m.mastery_score,0) mastery_score,COALESCE(m.attempts,0) attempts,COALESCE(m.correct_count,0) correct_count
           FROM concepts c LEFT JOIN student_concept_mastery m ON m.concept_id=c.id AND m.user_id=? ORDER BY c.order_index`, [userId]),
    query('SELECT COUNT(*) total, COALESCE(SUM(is_correct),0) correct FROM student_answers WHERE user_id=?', [userId]),
    query('SELECT COUNT(*) total FROM code_submissions WHERE user_id=?', [userId]),
    buildRecommendation(userId)
  ]);
  const average = mastery.length ? Math.round(mastery.reduce((s, c) => s + Number(c.mastery_score), 0) / mastery.length) : 0;
  res.json({
    stats: { mastery: average, concepts: mastery.length, assessed: mastery.filter(c => Number(c.attempts) > 0).length, quizAccuracy: Number(answers[0].total) ? Math.round(Number(answers[0].correct) / Number(answers[0].total) * 100) : 0, submissions: Number(submissions[0].total) },
    concepts: mastery,
    recent: await query(`SELECT 'assessment' type, q.question_text title, sa.is_correct outcome, sa.created_at
                         FROM student_answers sa JOIN diagnostic_questions q ON q.id=sa.question_id WHERE sa.user_id=?
                         UNION ALL SELECT 'code' type, cc.title, (cs.score>=70) outcome, cs.created_at
                         FROM code_submissions cs JOIN coding_challenges cc ON cc.id=cs.challenge_id WHERE cs.user_id=?
                         ORDER BY created_at DESC LIMIT 5`, [userId, userId]),
    recommendation
  });
}));

app.get('/api/concepts', requireAuth, asyncRoute(async (req, res) => {
  const rows = await query(`SELECT c.id,c.slug,c.title,c.description,c.category,c.level,c.order_index,c.estimated_minutes,
    COALESCE(m.mastery_score,0) mastery_score,COALESCE(m.attempts,0) attempts,
    GROUP_CONCAT(DISTINCT p.title ORDER BY p.order_index SEPARATOR '||') prerequisites,
    GROUP_CONCAT(DISTINCT cp.prerequisite_id ORDER BY p.order_index SEPARATOR ',') prerequisite_ids
    FROM concepts c LEFT JOIN student_concept_mastery m ON m.concept_id=c.id AND m.user_id=?
    LEFT JOIN concept_prerequisites rel ON rel.concept_id=c.id LEFT JOIN concepts p ON p.id=rel.prerequisite_id
    LEFT JOIN concept_prerequisites cp ON cp.concept_id=c.id
    GROUP BY c.id ORDER BY c.order_index`, [req.session.user.id]);
  const ids = await query('SELECT concept_id,prerequisite_id FROM concept_prerequisites');
  const progress = new Map(rows.map(r => [Number(r.id), Number(r.mastery_score)]));
  const prereqMap = new Map();
  for (const edge of ids) { if (!prereqMap.has(Number(edge.concept_id))) prereqMap.set(Number(edge.concept_id), []); prereqMap.get(Number(edge.concept_id)).push(Number(edge.prerequisite_id)); }
  const result = rows.map(r => {
    const score = Number(r.mastery_score);
    const prereqs = prereqMap.get(Number(r.id)) || [];
    const missingPrerequisites = prereqs.filter(pid => (progress.get(pid) || 0) < 55);
    const locked = missingPrerequisites.length > 0;
    return { id: Number(r.id), slug: r.slug, title: r.title, description: r.description, category: r.category, level: r.level, order_index: r.order_index, estimated_minutes: r.estimated_minutes, mastery_score: score, attempts: Number(r.attempts), prerequisites: r.prerequisites ? r.prerequisites.split('||') : [], prerequisite_ids: prereqs, missing_prerequisite_ids: missingPrerequisites, status: score >= 80 ? 'Mastered' : Number(r.attempts) ? (score < 55 ? 'Needs revision' : 'In progress') : (locked ? 'Locked' : 'Available') };
  });
  res.json({ concepts: result });
}));

app.get('/api/diagnostic/questions', requireAuth, asyncRoute(async (_req, res) => {
  const rows = await query(`SELECT q.id,q.concept_id,c.title concept_title,q.question_type,q.question_text,q.options_json,q.difficulty
    FROM diagnostic_questions q JOIN concepts c ON c.id=q.concept_id ORDER BY q.id`);
  res.json({ questions: rows.map(q => ({ ...q, options: jsonArray(q.options_json) })) });
}));

app.post('/api/diagnostic/submit', requireAuth, asyncRoute(async (req, res) => {
  const userId = req.session.user.id;
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (!answers.length || answers.length > 50) return res.status(400).json({ error: 'Submit at least one answer.' });
  const results = [];
  const byConcept = new Map();
  for (const a of answers) {
    const rows = await query('SELECT id,concept_id,correct_answer,explanation FROM diagnostic_questions WHERE id=?', [Number(a.questionId)]);
    if (!rows.length) continue;
    const q = rows[0];
    const correct = String(a.answer ?? '') === String(q.correct_answer);
    await query('INSERT INTO student_answers (user_id,question_id,selected_answer,is_correct,response_seconds) VALUES (?,?,?,?,?)', [userId, q.id, String(a.answer ?? ''), correct ? 1 : 0, Number.isFinite(Number(a.responseSeconds)) ? Math.max(0, Math.min(3600, Number(a.responseSeconds))) : null]);
    if (!byConcept.has(Number(q.concept_id))) byConcept.set(Number(q.concept_id), { total: 0, correct: 0 });
    const tally = byConcept.get(Number(q.concept_id)); tally.total++; if (correct) tally.correct++;
    results.push({ questionId: q.id, correct, explanation: q.explanation });
  }
  for (const [conceptId, tally] of byConcept) {
    const old = (await query('SELECT mastery_score,attempts,correct_count FROM student_concept_mastery WHERE user_id=? AND concept_id=?', [userId, conceptId]))[0] || { mastery_score: 0, attempts: 0, correct_count: 0 };
    const oldScore = Number(old.mastery_score) * Number(old.attempts);
    const attempts = Number(old.attempts) + tally.total;
    const score = attempts ? Math.round((oldScore + (tally.correct / tally.total) * 100 * tally.total) / attempts) : 0;
    await query(`INSERT INTO student_concept_mastery (user_id,concept_id,mastery_score,attempts,correct_count,last_evidence) VALUES (?,?,?,?,?,'diagnostic')
      ON DUPLICATE KEY UPDATE mastery_score=VALUES(mastery_score),attempts=VALUES(attempts),correct_count=correct_count+VALUES(correct_count),last_evidence='diagnostic'`, [userId, conceptId, score, tally.total, tally.correct]);
  }
  const correctCount = results.filter(r => r.correct).length;
  res.json({ total: results.length, correct: correctCount, score: results.length ? Math.round(correctCount / results.length * 100) : 0, results, message: 'Your mastery profile has been updated from this assessment.' });
}));

async function buildRecommendation(userId) {
  const concepts = await query(`SELECT c.id,c.title,c.description,c.order_index,COALESCE(m.mastery_score,0) score,COALESCE(m.attempts,0) attempts
    FROM concepts c LEFT JOIN student_concept_mastery m ON m.concept_id=c.id AND m.user_id=? ORDER BY c.order_index`, [userId]);
  const edges = await query('SELECT concept_id,prerequisite_id FROM concept_prerequisites');
  const byId = new Map(concepts.map(c => [Number(c.id), c]));
  const prereqs = new Map();
  for (const e of edges) { if (!prereqs.has(Number(e.concept_id))) prereqs.set(Number(e.concept_id), []); prereqs.get(Number(e.concept_id)).push(Number(e.prerequisite_id)); }
  const candidate = concepts.find(c => Number(c.attempts) > 0 && Number(c.score) < 65) || concepts.find(c => Number(c.attempts) === 0) || concepts[0];
  if (!candidate) return null;
  let target = candidate;
  const unmet = (prereqs.get(Number(candidate.id)) || []).map(id => byId.get(id)).filter(p => p && (Number(p.score) < 55 || Number(p.attempts) === 0));
  if (unmet.length) target = unmet.sort((a,b) => Number(a.score)-Number(b.score))[0];
  const score = Number(target.score);
  const actionType = Number(target.attempts) === 0 ? 'practice' : score < 45 ? 'revise' : score < 70 ? 'debug' : 'advance';
  const title = actionType === 'revise' ? `Revisit ${target.title}` : actionType === 'debug' ? `Debug a ${target.title} example` : actionType === 'advance' ? `Stretch your ${target.title} skills` : `Start ${target.title}`;
  const reason = Number(target.attempts) === 0
    ? `There is not enough evidence about ${target.title} yet. A short activity will establish a baseline.`
    : `Your recorded mastery for ${target.title} is ${score}%. Working on this concept is a transparent, prerequisite-aware next step.`;
  const active = await query(`SELECT id,title,reason FROM recommendations WHERE user_id=? AND concept_id=? AND action_type=? AND status IN ('recommended','started') ORDER BY id DESC LIMIT 1`, [userId, target.id, actionType]);
  if (active.length) return { id: Number(active[0].id), concept_id: Number(target.id), concept_title: target.title, action_type: actionType, title: active[0].title, reason: active[0].reason, mastery_score: score, simulated: false };
  const ins = await query('INSERT INTO recommendations (user_id,concept_id,action_type,title,reason,status) VALUES (?,?,?,?,?,\'recommended\')', [userId, target.id, actionType, title, reason]);
  return { id: ins.insertId, concept_id: Number(target.id), concept_title: target.title, action_type: actionType, title, reason, mastery_score: score, simulated: false };
}

app.get('/api/recommendations/next', requireAuth, asyncRoute(async (req, res) => res.json({ recommendation: await buildRecommendation(req.session.user.id) })));
app.post('/api/recommendations/:id/outcome', requireAuth, asyncRoute(async (req, res) => {
  const status = ['started','completed','skipped'].includes(req.body.status) ? req.body.status : 'started';
  const result = await query('UPDATE recommendations SET status=?,completed_at=IF(?=\'completed\',NOW(),completed_at) WHERE id=? AND user_id=?', [status, status, Number(req.params.id), req.session.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Recommendation not found.' });
  res.json({ ok: true });
}));

app.post('/api/editor/events', requireAuth, asyncRoute(async (req, res) => {
  const { challengeId = null, sessionKey, eventType, payload = {}, snapshotCode = null, snapshotLabel = 'Editor snapshot' } = req.body;
  const allowed = new Set(['code_change','paste','run_clicked','submit_clicked','editor_focus','editor_blur','visibility_change','snapshot']);
  if (!allowed.has(eventType) || !sessionKey || String(sessionKey).length > 100) return res.status(400).json({ error: 'Invalid editor event.' });
  const safePayload = { ...payload };
  if (typeof safePayload.preview === 'string') safePayload.preview = safePayload.preview.slice(0, 180);
  delete safePayload.code; delete safePayload.password; delete safePayload.token;
  const result = await query('INSERT INTO editor_events (user_id,challenge_id,session_key,event_type,payload_json) VALUES (?,?,?,?,?)', [req.session.user.id, challengeId ? Number(challengeId) : null, String(sessionKey), eventType, JSON.stringify(safePayload)]);
  let snapshotId = null;
  if (eventType === 'snapshot' && typeof snapshotCode === 'string') {
    const saved = await query('INSERT INTO code_snapshots (user_id,challenge_id,session_key,label,source_code) VALUES (?,?,?,?,?)', [req.session.user.id, challengeId ? Number(challengeId) : null, String(sessionKey), String(snapshotLabel).slice(0,80), snapshotCode.slice(0,30000)]);
    snapshotId = saved.insertId;
  }
  res.status(201).json({ id: result.insertId, snapshotId });
}));
app.get('/api/timeline', requireAuth, asyncRoute(async (req, res) => {
  const challengeId = Number(req.query.challengeId || 0);
  const params = [req.session.user.id];
  let where = 'user_id=?';
  if (challengeId) { where += ' AND challenge_id=?'; params.push(challengeId); }
  const events = await query(`SELECT id,challenge_id,session_key,event_type,payload_json,created_at FROM editor_events WHERE ${where} ORDER BY created_at DESC LIMIT 250`, params);
  const submissions = await query(`SELECT cs.id,cs.challenge_id,cs.status,cs.score,cs.feedback,cs.created_at,cc.title challenge_title FROM code_submissions cs JOIN coding_challenges cc ON cc.id=cs.challenge_id WHERE cs.user_id=? ${challengeId ? 'AND cs.challenge_id=?' : ''} ORDER BY cs.created_at DESC LIMIT 20`, challengeId ? [req.session.user.id, challengeId] : [req.session.user.id]);
  const signals = await query(`SELECT s.id,s.signal_type,s.explanation,s.review_status,s.created_at,cc.title challenge_title FROM integrity_review_signals s LEFT JOIN coding_challenges cc ON cc.id=s.challenge_id WHERE s.user_id=? ${challengeId ? 'AND s.challenge_id=?' : ''} ORDER BY s.created_at DESC LIMIT 20`, challengeId ? [req.session.user.id, challengeId] : [req.session.user.id]);
  const snapshots = await query(`SELECT id,challenge_id,session_key,label,source_code,created_at FROM code_snapshots WHERE user_id=? ${challengeId ? 'AND challenge_id=?' : ''} ORDER BY created_at DESC LIMIT 50`, challengeId ? [req.session.user.id, challengeId] : [req.session.user.id]);
  res.json({ events: events.reverse().map(e => ({ ...e, payload: (() => { try { return typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : e.payload_json || {}; } catch { return {}; } })() })), submissions, signals, snapshots: snapshots.reverse() });
}));

function makeVivaQuestion(code, title, index) {
  const text = String(code || '');
  if (text.includes('%')) return { question: `In your submitted solution for “${title}”, what does the % operator do, and how does it affect the result?`, keywords: ['remainder','modulo','dividend','divisor'] };
  if (/\bfor\s*\(/.test(text) || /\bwhile\s*\(/.test(text)) return { question: `In “${title}”, explain the loop's stopping condition and what could happen if it never becomes false.`, keywords: ['condition','iteration','infinite','stop','terminat'] };
  if (/\bif\s*\(/.test(text)) return { question: `In “${title}”, explain the condition in your code and what happens on each branch.`, keywords: ['condition','true','false','branch','else'] };
  if (/\breturn\b/.test(text)) return { question: `In “${title}”, explain what your method returns and how the caller uses that value.`, keywords: ['return','value','method','caller','result'] };
  return { question: `Walk through the main logic of “${title}”. Identify the important input, operation, and expected output.`, keywords: ['input','logic','output','method','result'] };
}
app.post('/api/viva/start', requireAuth, asyncRoute(async (req, res) => {
  const submissionId = Number(req.body.submissionId);
  const rows = await query(`SELECT cs.*,cc.title challenge_title FROM code_submissions cs JOIN coding_challenges cc ON cc.id=cs.challenge_id WHERE cs.id=? AND cs.user_id=?`, [submissionId, req.session.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Choose one of your own code submissions first.' });
  const submission = rows[0];
  const sessionResult = await query('INSERT INTO viva_sessions (user_id,submission_id) VALUES (?,?)', [req.session.user.id, submission.id]);
  const questions = [makeVivaQuestion(submission.source_code, submission.challenge_title, 0), { question: `What is one edge case for “${submission.challenge_title}” that you would test, and why?`, keywords: ['edge','case','empty','zero','null','boundary','test'] }, { question: `If you changed one line in this solution, which behaviour could change and how would you verify it?`, keywords: ['line','change','test','verify','behaviour','result','assert'] }];
  for (const q of questions) await query('INSERT INTO viva_questions (session_id,question_text,expected_keywords_json) VALUES (?,?,?)', [sessionResult.insertId, q.question, JSON.stringify(q.keywords)]);
  const created = await query('SELECT id,question_text FROM viva_questions WHERE session_id=? ORDER BY id', [sessionResult.insertId]);
  res.status(201).json({ sessionId: sessionResult.insertId, submission: { id: submission.id, challenge_title: submission.challenge_title }, questions: created });
}));
app.post('/api/viva/:sessionId/answer', requireAuth, asyncRoute(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const questionId = Number(req.body.questionId);
  const answer = String(req.body.answer || '').trim().slice(0, 5000);
  const rows = await query(`SELECT q.*,s.user_id FROM viva_questions q JOIN viva_sessions s ON s.id=q.session_id WHERE q.id=? AND q.session_id=? AND s.user_id=?`, [questionId, sessionId, req.session.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Viva question not found.' });
  const q = rows[0];
  const words = jsonArray(q.expected_keywords_json).map(k => String(k).toLowerCase());
  const lower = answer.toLowerCase();
  const matched = words.filter(k => lower.includes(k));
  const score = words.length ? Math.min(100, Math.round(matched.length / Math.min(3, words.length) * 100)) : 0;
  const feedback = !answer ? 'Write a brief explanation in your own words.' : matched.length >= 2 ? `Your answer includes relevant reasoning signals (${matched.slice(0,3).join(', ')}). A trainer can review the full response for context.` : 'Add a clearer explanation of the code behaviour and include a concrete example or edge case.';
  await query('UPDATE viva_questions SET answer_text=?,score=?,feedback=? WHERE id=?', [answer, score, feedback, questionId]);
  const summary = await query('SELECT COUNT(*) total,COALESCE(AVG(score),0) score,SUM(answer_text IS NOT NULL AND answer_text<>\'\') answered FROM viva_questions WHERE session_id=?', [sessionId]);
  if (Number(summary[0].answered) >= Number(summary[0].total)) await query('UPDATE viva_sessions SET status=\'completed\',score=?,completed_at=NOW() WHERE id=?', [Number(summary[0].score), sessionId]);
  res.json({ score, feedback, matchedKeywords: matched, progress: { answered: Number(summary[0].answered), total: Number(summary[0].total) } });
}));
app.get('/api/viva/history', requireAuth, asyncRoute(async (req, res) => {
  const sessions = await query(`SELECT s.id,s.status,s.score,s.created_at,cc.title challenge_title,cs.id submission_id FROM viva_sessions s JOIN code_submissions cs ON cs.id=s.submission_id JOIN coding_challenges cc ON cc.id=cs.challenge_id WHERE s.user_id=? ORDER BY s.created_at DESC LIMIT 10`, [req.session.user.id]);
  res.json({ sessions });
}));

app.get('/api/trainer/concepts', requireTrainer, asyncRoute(async (_req, res) => {
  const concepts = await query('SELECT id,title,slug FROM concepts ORDER BY order_index');
  res.json({ concepts });
}));

app.post('/api/trainer/questions', requireTrainer, asyncRoute(async (req, res) => {
  const conceptId = Number(req.body.conceptId);
  const questionType = ['conceptual','output','debugging','application'].includes(req.body.questionType) ? req.body.questionType : 'conceptual';
  const questionText = String(req.body.questionText || '').trim();
  const options = Array.isArray(req.body.options) ? req.body.options.slice(0, 4).map((o, i) => ({ value: ['a','b','c','d'][i], label: String(o || '').trim() })) : [];
  const correctAnswer = String(req.body.correctAnswer || '').toLowerCase();
  const explanation = String(req.body.explanation || '').trim();
  const difficulty = ['Easy','Medium','Hard'].includes(req.body.difficulty) ? req.body.difficulty : 'Easy';
  if (!conceptId || questionText.length < 10 || options.length !== 4 || options.some(o => !o.label) || !['a','b','c','d'].includes(correctAnswer) || explanation.length < 5) {
    return res.status(400).json({ error: 'Provide a question, four options, the correct option, and an explanation.' });
  }
  const concept = await query('SELECT id FROM concepts WHERE id=?', [conceptId]);
  if (!concept.length) return res.status(400).json({ error: 'The selected concept does not exist.' });
  const result = await query('INSERT INTO diagnostic_questions (concept_id,question_type,question_text,options_json,correct_answer,explanation,difficulty) VALUES (?,?,?,?,?,?,?)', [conceptId,questionType,questionText,JSON.stringify(options),correctAnswer,explanation,difficulty]);
  res.status(201).json({ ok: true, questionId: result.insertId, message: 'Question published to Learning DNA.' });
}));

app.get('/api/trainer/overview', requireTrainer, asyncRoute(async (_req, res) => {
  const [students, signals, concepts, totals] = await Promise.all([
    query(`SELECT u.id,u.name,u.email,COUNT(DISTINCT sa.id) answer_count,COUNT(DISTINCT cs.id) submission_count,ROUND(COALESCE(AVG(m.mastery_score),0)) mastery,
      COUNT(DISTINCT CASE WHEN m.attempts>0 AND m.mastery_score<55 THEN m.concept_id END) weak_concepts
      FROM users u LEFT JOIN student_answers sa ON sa.user_id=u.id LEFT JOIN code_submissions cs ON cs.user_id=u.id LEFT JOIN student_concept_mastery m ON m.user_id=u.id
      WHERE u.role='student' GROUP BY u.id ORDER BY mastery ASC,u.name`),
    query(`SELECT s.id,s.signal_type,s.explanation,s.review_status,s.trainer_note,s.created_at,u.name student_name,cc.title challenge_title FROM integrity_review_signals s JOIN users u ON u.id=s.user_id LEFT JOIN coding_challenges cc ON cc.id=s.challenge_id ORDER BY (s.review_status='not_reviewed') DESC,s.created_at DESC LIMIT 20`),
    query(`SELECT c.id,c.title,ROUND(COALESCE(AVG(NULLIF(m.mastery_score,0)),0)) average_mastery,COUNT(DISTINCT CASE WHEN m.attempts>0 THEN m.user_id END) assessed_students FROM concepts c LEFT JOIN student_concept_mastery m ON m.concept_id=c.id GROUP BY c.id ORDER BY c.order_index`),
    query(`SELECT (SELECT COUNT(*) FROM users WHERE role='student') students,(SELECT COUNT(*) FROM code_submissions) submissions,(SELECT COUNT(*) FROM integrity_review_signals WHERE review_status='not_reviewed') open_reviews,(SELECT COUNT(*) FROM student_answers) attempts`)
  ]);
  res.json({ students, signals, concepts, totals: totals[0] });
}));
app.patch('/api/trainer/signals/:id', requireTrainer, asyncRoute(async (req, res) => {
  const reviewStatus = ['reviewed_no_concern','further_discussion_required','not_reviewed'].includes(req.body.reviewStatus) ? req.body.reviewStatus : 'not_reviewed';
  const note = String(req.body.note || '').slice(0, 3000);
  const result = await query('UPDATE integrity_review_signals SET review_status=?,trainer_note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?', [reviewStatus, note || null, req.session.user.id, Number(req.params.id)]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Review signal not found.' });
  res.json({ ok: true });
}));
app.post('/api/trainer/feedback', requireTrainer, asyncRoute(async (req, res) => {
  const studentId = Number(req.body.studentId); const conceptId = req.body.conceptId ? Number(req.body.conceptId) : null; const feedback = String(req.body.feedback || '').trim();
  if (!studentId || feedback.length < 3) return res.status(400).json({ error: 'Choose a student and enter useful feedback.' });
  await query('INSERT INTO trainer_feedback (trainer_id,student_id,concept_id,feedback) VALUES (?,?,?,?)', [req.session.user.id, studentId, conceptId, feedback.slice(0,3000)]);
  res.status(201).json({ ok: true });
}));

app.use((req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((err, _req, res, _next) => {
  console.error('API error:', err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds the 1 MB limit.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') return res.status(503).json({ error: 'The database schema or Java assessment migration is missing. Import backend/sql/schema.sql and backend/sql/migrations/001_java_assessment.sql.' });
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_BAD_DB_ERROR') return res.status(503).json({ error: 'MySQL is unavailable or the database has not been created. Start MySQL in XAMPP and import backend/sql/schema.sql.' });
  res.status(500).json({ error: 'Something went wrong. Check the backend terminal for details.' });
});

app.listen(PORT, () => console.log(`ADAPTIX AI API running at http://localhost:${PORT}`));
