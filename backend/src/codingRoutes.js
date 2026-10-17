import express from 'express';
import { pool, query } from './db.js';
import { compareOutput, executeJava, javaSandboxStatus } from './javaSandbox.js';
import { publicRunSummary, safePublicTestResults, studentSubmissionSummary } from './assessmentResults.js';

const MAX_SOURCE_LENGTH = 30000;
const MAX_CASE_LENGTH = 20000;
const MAX_CASES = 20;
const MAX_JOB_TIME_MS = 45000;
const ALLOWED_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ALLOWED_COMPARISONS = ['exact', 'trim', 'tokens'];
const activeUsers = new Set();
const recentExecutions = new Map();

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const jsonArray = value => Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value || '[]') : [];
const parseJson = (value, fallback = []) => {
  try { return jsonArray(value); } catch { return fallback; }
};
const mysqlLocalDateTime = date => [
  date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')
].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

function validateTestCases(value, visibility) {
  if (!Array.isArray(value)) throw new Error(`${visibility === 'hidden' ? 'Hidden' : 'Public'} test cases must be an array.`);
  return value.map((test, index) => {
    if (!test || typeof test !== 'object' || Array.isArray(test)) throw new Error(`Test case ${index + 1} is invalid.`);
    if (typeof test.input !== 'string' || typeof test.expectedOutput !== 'string') throw new Error(`Test case ${index + 1} needs string input and expected output.`);
    const input = test.input;
    const expectedOutput = test.expectedOutput;
    const comparison = test.comparison === undefined ? 'trim' : test.comparison;
    if (!ALLOWED_COMPARISONS.includes(comparison)) throw new Error(`Test case ${index + 1} has an unsupported comparison rule.`);
    if (input.length > MAX_CASE_LENGTH || expectedOutput.length > MAX_CASE_LENGTH) throw new Error(`Test case ${index + 1} exceeds the 20,000 character limit.`);
    return { input, expectedOutput, comparison, visibility };
  });
}

function validateQuestion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Provide a coding question object.');
  if (body.tagConceptIds !== undefined && !Array.isArray(body.tagConceptIds)) throw new Error('Concept tags must be an array.');
  if (body.prerequisiteConceptIds !== undefined && !Array.isArray(body.prerequisiteConceptIds)) throw new Error('Prerequisite concepts must be an array.');
  if (body.hints !== undefined && !Array.isArray(body.hints)) throw new Error('Hints must be an array of text values.');
  if ((body.tagConceptIds?.length || 0) > 50 || (body.prerequisiteConceptIds?.length || 0) > 50) throw new Error('Select no more than 50 concepts in each concept list.');
  if (body.tagConceptIds?.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0) || body.prerequisiteConceptIds?.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Concept identifiers must be positive integers.');
  }
  if (body.difficulty !== undefined && !ALLOWED_DIFFICULTIES.includes(body.difficulty)) throw new Error('Choose Easy, Medium, or Hard difficulty.');
  if (body.status !== undefined && !['draft', 'published'].includes(body.status)) throw new Error('Choose draft or published status.');
  if (body.hints?.some(hint => typeof hint !== 'string' || hint.length > 500)) throw new Error('Each hint must be text no longer than 500 characters.');
  if (body.minutes !== undefined && (!Number.isInteger(Number(body.minutes)) || Number(body.minutes) < 5 || Number(body.minutes) > 120)) throw new Error('Estimated minutes must be between 5 and 120.');
  const conceptId = Number(body.conceptId);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const starterCode = typeof body.starterCode === 'string' ? body.starterCode : '';
  const difficulty = ALLOWED_DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'Easy';
  const status = body.status === 'published' ? 'published' : 'draft';
  const publicCases = validateTestCases(body.publicTests === undefined ? [] : body.publicTests, 'public');
  const hiddenCases = validateTestCases(body.hiddenTests === undefined ? [] : body.hiddenTests, 'hidden');
  const tags = [...new Set((Array.isArray(body.tagConceptIds) ? body.tagConceptIds : []).map(Number).filter(Number.isInteger))];
  if (!tags.includes(conceptId) && conceptId > 0) tags.unshift(conceptId);
  const prerequisites = [...new Set((Array.isArray(body.prerequisiteConceptIds) ? body.prerequisiteConceptIds : []).map(Number).filter(Number.isInteger))];
  const hints = (Array.isArray(body.hints) ? body.hints : []).map(hint => String(hint).trim()).filter(Boolean).slice(0, 10);
  const timeLimitMs = Number(body.timeLimitMs);
  const memoryLimitMb = Number(body.memoryLimitMb);
  const marks = Number(body.marks);
  if (!Number.isSafeInteger(conceptId) || conceptId <= 0 || title.length < 4 || title.length > 180 || prompt.length < 12 || prompt.length > 12000 || starterCode.trim().length < 5 || starterCode.length > MAX_SOURCE_LENGTH) {
    throw new Error('Choose a concept and provide a title, problem statement, and starter code within the stated limits.');
  }
  if (publicCases.length + hiddenCases.length > MAX_CASES) throw new Error(`A question can have no more than ${MAX_CASES} test cases.`);
  if (status === 'published' && (!publicCases.length || !hiddenCases.length)) throw new Error('A published question needs at least one public and one hidden test case.');
  if (!Number.isInteger(timeLimitMs) || timeLimitMs < 500 || timeLimitMs > 3000 || !Number.isInteger(memoryLimitMb) || memoryLimitMb < 256 || memoryLimitMb > 512 || !Number.isInteger(marks) || marks < 1 || marks > 1000) {
    throw new Error('Use a 500–3000 ms time limit, 256–512 MB memory limit, and 1–1000 marks.');
  }
  return {
    conceptId, title, prompt, starterCode, difficulty, status, publicCases, hiddenCases, tags, prerequisites, hints,
    timeLimitMs, memoryLimitMb, marks,
    minutes: Math.max(5, Math.min(120, Number(body.minutes) || 20))
  };
}

async function verifyConceptIds(conceptIds) {
  if (!conceptIds.length) return true;
  const placeholders = conceptIds.map(() => '?').join(',');
  const found = await query(`SELECT id FROM concepts WHERE id IN (${placeholders})`, conceptIds);
  return found.length === conceptIds.length;
}

async function replaceRelatedData(connection, challengeId, question) {
  await connection.execute('DELETE FROM coding_test_cases WHERE challenge_id=?', [challengeId]);
  await connection.execute('DELETE FROM coding_challenge_concepts WHERE challenge_id=?', [challengeId]);
  for (const test of [...question.publicCases, ...question.hiddenCases]) {
    await connection.execute('INSERT INTO coding_test_cases (challenge_id,visibility,input_data,expected_output,comparison_rule) VALUES (?,?,?,?,?)', [challengeId, test.visibility, test.input, test.expectedOutput, test.comparison]);
  }
  for (const conceptId of question.tags) {
    await connection.execute('INSERT INTO coding_challenge_concepts (challenge_id,concept_id,relation_type) VALUES (?,?,?)', [challengeId, conceptId, 'tag']);
  }
  for (const conceptId of question.prerequisites) {
    await connection.execute('INSERT INTO coding_challenge_concepts (challenge_id,concept_id,relation_type) VALUES (?,?,?)', [challengeId, conceptId, 'prerequisite']);
  }
}

async function loadTestCases(challengeId, visibility = null) {
  const suffix = visibility ? ' AND visibility=?' : '';
  const params = visibility ? [challengeId, visibility] : [challengeId];
  return query(`SELECT id,visibility,input_data,expected_output,comparison_rule FROM coding_test_cases WHERE challenge_id=?${suffix} ORDER BY id`, params);
}

async function runCases(source, testCases, challenge, overallDeadline) {
  const results = [];
  let executionTimeMs = 0;
  let executionStatus = 'completed';
  let compilationStatus = 'passed';
  let overallStatus = 'Accepted';
  for (let index = 0; index < testCases.length; index++) {
    const test = testCases[index];
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) {
      executionStatus = 'time_limit_exceeded';
      overallStatus = 'Time Limit Exceeded';
      results.push(...testCases.slice(index).map((pending, pendingIndex) => ({ test: pending, visibility: pending.visibility, index: index + pendingIndex + 1, passed: false, status: 'not_run', executionTimeMs: 0, stdout: '', stderr: '' })));
      break;
    }
    const executed = await executeJava(source, test.input_data, {
      timeLimitMs: Math.min(Number(challenge.time_limit_ms), remaining),
      memoryLimitMb: Number(challenge.memory_limit_mb)
    });
    executionTimeMs += executed.executionTimeMs;
    if (executed.status === 'compilation_error') {
      compilationStatus = 'failed';
      executionStatus = 'not_started';
      overallStatus = 'Compilation Error';
      results.push({ test, index: index + 1, passed: false, status: 'compilation_error', executionTimeMs: executed.executionTimeMs, stdout: '', stderr: executed.stderr });
      results.push(...testCases.slice(index + 1).map((pending, pendingIndex) => ({ test: pending, index: index + pendingIndex + 2, passed: false, status: 'not_run', executionTimeMs: 0, stdout: '', stderr: '' })));
      break;
    }
    if (executed.status === 'internal_execution_error') {
      if (!results.length) compilationStatus = 'unknown';
      executionStatus = 'internal_execution_error';
      overallStatus = 'Internal Execution Error';
      results.push({ test, index: index + 1, passed: false, status: executed.status, executionTimeMs: executed.executionTimeMs, stdout: '', stderr: executed.stderr });
      results.push(...testCases.slice(index + 1).map((pending, pendingIndex) => ({ test: pending, index: index + pendingIndex + 2, passed: false, status: 'not_run', executionTimeMs: 0, stdout: '', stderr: '' })));
      break;
    }
    if (executed.status === 'time_limit_exceeded') {
      if (!results.length) compilationStatus = 'unknown';
      executionStatus = 'time_limit_exceeded';
      overallStatus = 'Time Limit Exceeded';
    } else if (executed.status === 'runtime_error') {
      executionStatus = 'runtime_error';
      if (overallStatus !== 'Time Limit Exceeded') overallStatus = 'Runtime Error';
    }
    const passed = executed.status === 'completed' && compareOutput(executed.stdout, test.expected_output, test.comparison_rule);
    if (!passed && overallStatus === 'Accepted') overallStatus = 'Wrong Answer';
    results.push({ test, index: index + 1, passed, status: executed.status === 'completed' ? (passed ? 'passed' : 'wrong_answer') : executed.status, executionTimeMs: executed.executionTimeMs, stdout: executed.stdout, stderr: executed.stderr });
  }
  if (executionStatus === 'runtime_error' && results.some(result => result.status === 'time_limit_exceeded')) {
    executionStatus = 'time_limit_exceeded';
    overallStatus = 'Time Limit Exceeded';
  }
  const passedCount = results.filter(result => result.passed).length;
  return {
    results, passedCount, totalCount: testCases.length,
    passPercentage: testCases.length ? Math.round(passedCount / testCases.length * 100) : 0,
    compilationStatus, executionStatus, overallStatus, executionTimeMs
  };
}

function requestLimit(req, res, next) {
  const now = Date.now();
  for (const [userId, timestamps] of recentExecutions) {
    if (!timestamps.length || now - timestamps[timestamps.length - 1] >= 60_000) recentExecutions.delete(userId);
  }
  const key = String(req.session.user.id);
  const history = (recentExecutions.get(key) || []).filter(time => now - time < 60_000);
  if (history.length >= 6) return res.status(429).json({ error: 'Execution limit reached. Wait a minute before trying again.' });
  history.push(now);
  recentExecutions.set(key, history);
  if (activeUsers.has(key)) return res.status(429).json({ error: 'Only one Java execution can run at a time for your account.' });
  if (activeUsers.size >= 2) return res.status(503).json({ error: 'The Java execution queue is busy. Try again shortly.' });
  activeUsers.add(key);
  req.releaseExecution = () => activeUsers.delete(key);
  next();
}

function publicTest(test) {
  return { id: Number(test.id), input: test.input_data, expectedOutput: test.expected_output, comparison: test.comparison_rule };
}

export function createCodingRouter({ requireAuth, requireTrainer }) {
  const router = express.Router();

  router.get('/challenges', requireAuth, asyncRoute(async (req, res) => {
    const rows = await query(`SELECT cc.id,cc.title,cc.difficulty,cc.prompt,cc.estimated_minutes,c.title concept_title,c.id concept_id
      FROM coding_challenges cc JOIN concepts c ON c.id=cc.concept_id
      WHERE cc.status='published'
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='public')
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='hidden')
      ORDER BY cc.id`);
    res.json({ challenges: rows });
  }));

  router.get('/challenges/:id', requireAuth, asyncRoute(async (req, res) => {
    const challengeId = Number(req.params.id);
    if (!Number.isSafeInteger(challengeId) || challengeId <= 0) return res.status(404).json({ error: 'Challenge not found.' });
    const rows = await query(`SELECT cc.id,cc.title,cc.difficulty,cc.prompt,cc.starter_code,cc.estimated_minutes,cc.concept_id,
      cc.time_limit_ms,cc.memory_limit_mb,cc.marks,cc.hints_json,c.title concept_title
      FROM coding_challenges cc JOIN concepts c ON c.id=cc.concept_id
      WHERE cc.id=? AND cc.status='published'
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='public')
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='hidden')`, [challengeId]);
    if (!rows.length) return res.status(404).json({ error: 'Challenge not found.' });
    const challenge = rows[0];
    const [cases, concepts] = await Promise.all([
      loadTestCases(challengeId, 'public'),
      query(`SELECT cc.concept_id,cc.relation_type,c.title FROM coding_challenge_concepts cc JOIN concepts c ON c.id=cc.concept_id WHERE cc.challenge_id=?`, [challengeId])
    ]);
    res.json({ challenge: {
      id: Number(challenge.id), title: challenge.title, difficulty: challenge.difficulty, prompt: challenge.prompt,
      starter_code: challenge.starter_code, estimated_minutes: challenge.estimated_minutes, concept_id: Number(challenge.concept_id),
      concept_title: challenge.concept_title, time_limit_ms: challenge.time_limit_ms, memory_limit_mb: challenge.memory_limit_mb,
      marks: challenge.marks, hints: parseJson(challenge.hints_json),
      concepts: concepts.filter(item => item.relation_type === 'tag').map(item => ({ id: Number(item.concept_id), title: item.title })),
      prerequisites: concepts.filter(item => item.relation_type === 'prerequisite').map(item => ({ id: Number(item.concept_id), title: item.title })),
      public_tests: cases.map(publicTest)
    } });
  }));

  async function executeRequest(req, res, submission, contestId = null) {
    const challengeId = Number(req.params.id);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const source = typeof body.code === 'string' ? body.code : '';
    if (source.length > MAX_SOURCE_LENGTH) return res.status(413).json({ error: `Source code exceeds the ${MAX_SOURCE_LENGTH} character limit.` });
    if (!source.trim()) return res.status(400).json({ error: 'Enter Java source code before running or submitting.' });
    if (!Number.isSafeInteger(challengeId) || challengeId <= 0) return res.status(404).json({ error: 'Challenge not found.' });
    const challengeRows = await query(`SELECT c.id,c.title,c.time_limit_ms,c.memory_limit_mb,c.concept_id FROM coding_challenges c
      WHERE c.id=? AND c.status='published'
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=c.id AND tc.visibility='public')
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=c.id AND tc.visibility='hidden')`, [challengeId]);
    if (!challengeRows.length) return res.status(404).json({ error: 'Challenge not found.' });
    const challenge = challengeRows[0];
    if (contestId !== null) {
      const contest = await query(`SELECT ccq.points,entry.started_at,entry.submitted_at,c.duration_minutes,c.ends_at,c.status
        FROM coding_contests c JOIN coding_contest_questions ccq ON ccq.contest_id=c.id AND ccq.challenge_id=?
        JOIN coding_contest_entries entry ON entry.contest_id=c.id AND entry.user_id=?
        WHERE c.id=? AND c.status='published'`, [challengeId, req.session.user.id, contestId]);
      if (!contest.length) return res.status(403).json({ error: 'Start this contest and choose one of its questions first.' });
      const entry = contest[0];
      const deadline = Math.min(
        new Date(entry.started_at).getTime() + Number(entry.duration_minutes) * 60_000,
        entry.ends_at ? new Date(entry.ends_at).getTime() : Number.POSITIVE_INFINITY
      );
      if (entry.submitted_at || Date.now() >= deadline) return res.status(403).json({ error: 'Your contest time has expired or the contest is closed.' });
    }
    const testCases = await loadTestCases(challengeId, submission ? null : 'public');
    if (!testCases.length) return res.status(409).json({ error: 'This question has no configured test cases.' });
    const sandbox = await javaSandboxStatus();
    if (!sandbox.operational) {
      return res.status(503).json({ error: 'Java execution is not operational. Configure Docker Desktop and the ADAPTIX Java sandbox before running code.', execution: sandbox.status });
    }
    const result = await runCases(source, testCases, challenge, Date.now() + MAX_JOB_TIME_MS);
    if (!submission) {
      return res.json({ result: publicRunSummary(result) });
    }

    const userId = req.session.user.id;
    const legacyStatus = result.overallStatus === 'Accepted' ? 'structure_checks_passed' : 'needs_work';
    const feedback = result.overallStatus === 'Accepted'
      ? `Accepted: all ${result.totalCount} tests passed.`
      : `${result.overallStatus}: ${result.passedCount} of ${result.totalCount} tests passed.`;
    const connection = await pool.getConnection();
    let assessmentId;
    try {
      await connection.beginTransaction();
      const [legacy] = await connection.execute('INSERT INTO code_submissions (user_id,challenge_id,source_code,status,session_key,score,feedback) VALUES (?,?,?,?,?,?,?)', [
        userId, challengeId, source, legacyStatus, String(body.sessionKey || '').slice(0, 100) || null,
        result.passPercentage, feedback
      ]);
      const [saved] = await connection.execute(`INSERT INTO coding_assessment_submissions
        (user_id,challenge_id,contest_id,legacy_submission_id,source_code,status,tests_passed,total_tests,pass_percentage,compilation_status,execution_status,execution_time_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
        userId, challengeId, contestId, legacy.insertId, source, result.overallStatus, result.passedCount, result.totalCount,
        result.passPercentage, result.compilationStatus, result.executionStatus, result.executionTimeMs
      ]);
      assessmentId = saved.insertId;
      for (const item of result.results) {
        await connection.execute(`INSERT INTO coding_test_results
          (submission_id,test_case_id,test_index,visibility,passed,result_status,execution_time_ms)
          VALUES (?,?,?,?,?,?,?)`, [
          assessmentId, item.test.id, item.index, item.test.visibility, item.passed ? 1 : 0, item.status, item.executionTimeMs
        ]);
      }
      const concepts = await connection.execute('SELECT concept_id FROM coding_challenge_concepts WHERE challenge_id=? AND relation_type=\'tag\'', [challengeId]);
      const conceptIds = [...new Set([Number(challenge.concept_id), ...concepts[0].map(item => Number(item.concept_id))])];
      for (const conceptId of conceptIds) {
        const relevant = result.results;
        const testsPassed = relevant.filter(item => item.passed).length;
        const [attemptCount] = await connection.execute(`SELECT COUNT(*) attempt_count FROM coding_concept_evidence e
          JOIN coding_assessment_submissions s ON s.id=e.submission_id WHERE e.user_id=? AND e.concept_id=?`, [userId, conceptId]);
        await connection.execute(`INSERT INTO coding_concept_evidence
          (user_id,submission_id,concept_id,attempt_number,tests_passed,total_tests,compilation_failed,runtime_failed,incorrect_submission)
          VALUES (?,?,?,?,?,?,?,?,?)`, [
          userId, assessmentId, conceptId, Number(attemptCount[0].attempt_count) + 1, testsPassed, relevant.length,
          result.compilationStatus === 'failed' ? 1 : 0,
          ['Runtime Error', 'Time Limit Exceeded', 'Internal Execution Error'].includes(result.overallStatus) ? 1 : 0,
          result.overallStatus !== 'Accepted' ? 1 : 0
        ]);
      }
      // If this submission belongs to a started independent verification, finalize that evidence.
      // Only the student's own started assessment for this exact challenge can be updated.
      await connection.execute(`UPDATE mastery_assessments
        SET passed=?, completed_at=NOW(),
            evidence_json=JSON_SET(COALESCE(evidence_json, JSON_OBJECT()), '$.state', 'completed',
              '$.submissionId', ?, '$.status', ?, '$.passPercentage', ?)
        WHERE id=(SELECT id FROM (SELECT id FROM mastery_assessments
          WHERE user_id=? AND challenge_id=? AND assessment_type='verification'
            AND completed_at IS NULL
          ORDER BY started_at DESC, id DESC LIMIT 1) active_assessment)`, [
        result.overallStatus === 'Accepted' ? 1 : 0, assessmentId, result.overallStatus,
        result.passPercentage, userId, challengeId
      ]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.status(201).json({
      submission: studentSubmissionSummary(assessmentId, challengeId, result, feedback)
    });
  }

  router.post('/challenges/:id/run', requireAuth, requestLimit, asyncRoute(async (req, res) => {
    try { await executeRequest(req, res, false); } finally { req.releaseExecution(); }
  }));
  router.post('/challenges/:id/submit', requireAuth, requestLimit, asyncRoute(async (req, res) => {
    try { await executeRequest(req, res, true); } finally { req.releaseExecution(); }
  }));
  router.post('/contests/:contestId/challenges/:id/submit', requireAuth, requestLimit, asyncRoute(async (req, res) => {
    try {
      const contestId = Number(req.params.contestId);
      if (!Number.isSafeInteger(contestId) || contestId <= 0) return res.status(404).json({ error: 'Contest not found.' });
      await executeRequest(req, res, true, contestId);
    } finally {
      req.releaseExecution();
    }
  }));

  router.get('/contests', requireAuth, asyncRoute(async (_req, res) => {
    const contests = await query(`SELECT c.id,c.title,c.description,c.duration_minutes,c.starts_at,c.ends_at,
      COUNT(DISTINCT cq.challenge_id) question_count,COUNT(DISTINCT e.user_id) participant_count
      FROM coding_contests c LEFT JOIN coding_contest_questions cq ON cq.contest_id=c.id
      LEFT JOIN coding_contest_entries e ON e.contest_id=c.id
      WHERE c.status='published' AND (c.starts_at IS NULL OR c.starts_at<=NOW())
        AND (c.ends_at IS NULL OR c.ends_at>NOW())
      GROUP BY c.id ORDER BY c.starts_at IS NULL,c.starts_at,c.id DESC`);
    res.json({ contests });
  }));

  router.get('/contests/:id', requireAuth, asyncRoute(async (req, res) => {
    const contestId = Number(req.params.id);
    if (!Number.isSafeInteger(contestId) || contestId <= 0) return res.status(404).json({ error: 'Contest not found.' });
    const rows = await query(`SELECT c.id,c.title,c.description,c.duration_minutes,c.starts_at,c.ends_at,c.status,
      entry.started_at,entry.submitted_at,
      (SELECT COUNT(*) FROM coding_contest_questions WHERE contest_id=c.id) question_count
      FROM coding_contests c LEFT JOIN coding_contest_entries entry ON entry.contest_id=c.id AND entry.user_id=?
      WHERE c.id=? AND c.status='published'`, [req.session.user.id, contestId]);
    if (!rows.length) return res.status(404).json({ error: 'Contest not found.' });
    const contest = rows[0];
    const questions = await query(`SELECT q.challenge_id,q.points,q.order_index,c.title,c.difficulty,c.prompt,c.estimated_minutes
      FROM coding_contest_questions q JOIN coding_challenges c ON c.id=q.challenge_id
      WHERE q.contest_id=? AND c.status='published' AND EXISTS (SELECT 1 FROM coding_test_cases t WHERE t.challenge_id=c.id AND t.visibility='hidden')
      ORDER BY q.order_index,q.challenge_id`, [contestId]);
    const deadline = contest.started_at ? Math.min(
      new Date(contest.started_at).getTime() + Number(contest.duration_minutes) * 60_000,
      contest.ends_at ? new Date(contest.ends_at).getTime() : Number.POSITIVE_INFINITY
    ) : null;
    res.json({ contest: {
      ...contest,
      questions,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      isStarted: Boolean(contest.started_at),
      isExpired: Boolean(contest.submitted_at || (deadline && Date.now() >= deadline))
    } });
  }));

  router.post('/contests/:id/start', requireAuth, asyncRoute(async (req, res) => {
    const contestId = Number(req.params.id);
    if (!Number.isSafeInteger(contestId) || contestId <= 0) return res.status(404).json({ error: 'Contest not found.' });
    const contests = await query(`SELECT id,duration_minutes,starts_at,ends_at FROM coding_contests
      WHERE id=? AND status='published' AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>NOW())`, [contestId]);
    if (!contests.length) return res.status(404).json({ error: 'Contest is not open for participation.' });
    await query('INSERT IGNORE INTO coding_contest_entries (contest_id,user_id) VALUES (?,?)', [contestId, req.session.user.id]);
    const entries = await query('SELECT started_at,submitted_at FROM coding_contest_entries WHERE contest_id=? AND user_id=?', [contestId, req.session.user.id]);
    res.status(201).json({
      startedAt: entries[0].started_at,
      deadline: new Date(Math.min(
        new Date(entries[0].started_at).getTime() + Number(contests[0].duration_minutes) * 60_000,
        contests[0].ends_at ? new Date(contests[0].ends_at).getTime() : Number.POSITIVE_INFINITY
      )).toISOString(),
      alreadySubmitted: Boolean(entries[0].submitted_at)
    });
  }));

  router.get('/contests/:id/leaderboard', requireAuth, asyncRoute(async (req, res) => {
    const contestId = Number(req.params.id);
    if (!Number.isSafeInteger(contestId) || contestId <= 0) return res.status(404).json({ error: 'Contest not found.' });
    const exists = await query('SELECT id FROM coding_contests WHERE id=? AND status=\'published\'', [contestId]);
    if (!exists.length) return res.status(404).json({ error: 'Contest not found.' });
    const leaderboard = await query(`SELECT entry.user_id,user.name user_name,
      ROUND(COALESCE(SUM(best.best_points),0)) score,
      MAX(best.last_submission) last_submission
      FROM coding_contest_entries entry JOIN users u ON u.id=entry.user_id
      LEFT JOIN (
        SELECT s.user_id,s.challenge_id,MAX(s.pass_percentage*cq.points/100) best_points,MAX(s.created_at) last_submission
        FROM coding_assessment_submissions s JOIN coding_contest_questions cq
          ON cq.contest_id=s.contest_id AND cq.challenge_id=s.challenge_id
        WHERE s.contest_id=? GROUP BY s.user_id,s.challenge_id
      ) best ON best.user_id=entry.user_id
      WHERE entry.contest_id=? GROUP BY entry.user_id,u.name
      ORDER BY score DESC,last_submission ASC,entry.user_id ASC LIMIT 100`, [contestId, contestId]);
    res.json({ leaderboard });
  }));

  router.get('/trainer/contest-options', requireTrainer, asyncRoute(async (req, res) => {
    const challenges = await query(`SELECT c.id,c.title,c.difficulty
      FROM coding_challenges c WHERE c.status='published' AND (c.owner_id IS NULL OR c.owner_id=?)
        AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=c.id AND tc.visibility='hidden')
      ORDER BY c.title`, [req.session.user.id]);
    res.json({ challenges });
  }));

  router.get('/trainer/contests', requireTrainer, asyncRoute(async (req, res) => {
    const contests = await query(`SELECT c.id,c.title,c.status,c.duration_minutes,c.starts_at,c.ends_at,
      COUNT(q.challenge_id) question_count
      FROM coding_contests c LEFT JOIN coding_contest_questions q ON q.contest_id=c.id
      WHERE c.owner_id=? GROUP BY c.id ORDER BY c.created_at DESC`, [req.session.user.id]);
    res.json({ contests });
  }));

  router.post('/trainer/contests', requireTrainer, asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const durationMinutes = Number(body.durationMinutes);
    const questionRows = Array.isArray(body.questions) ? body.questions : [];
    const questionIds = questionRows.map(question => question && typeof question === 'object' && !Array.isArray(question) ? Number(question.challengeId) : NaN);
    const startsAt = typeof body.startsAt === 'string' && body.startsAt ? new Date(body.startsAt) : null;
    const endsAt = typeof body.endsAt === 'string' && body.endsAt ? new Date(body.endsAt) : null;
    if (title.length < 4 || title.length > 180 || description.length < 10 || description.length > 5000 ||
        !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 300 ||
        questionRows.length < 1 || questionRows.length > 20 ||
        (body.startsAt != null && body.startsAt !== '' && typeof body.startsAt !== 'string') ||
        (body.endsAt != null && body.endsAt !== '' && typeof body.endsAt !== 'string') ||
        questionRows.some(question => !question || typeof question !== 'object' || Array.isArray(question) ||
          !Number.isInteger(Number(question.points)) || Number(question.points) < 1 || Number(question.points) > 10000) ||
        questionIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(questionIds).size !== questionIds.length ||
        (body.startsAt && Number.isNaN(startsAt.getTime())) || (body.endsAt && Number.isNaN(endsAt.getTime())) ||
        (startsAt && endsAt && endsAt <= startsAt)) {
      return res.status(400).json({ error: 'Provide a valid title, description, 5–300 minute duration, schedule, and 1–20 unique questions with positive points.' });
    }
    const marks = await query(`SELECT c.id FROM coding_challenges c WHERE c.id IN (${questionIds.map(() => '?').join(',')})
      AND c.status='published' AND (c.owner_id IS NULL OR c.owner_id=?)
      AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=c.id AND tc.visibility='hidden')`, [...questionIds, req.session.user.id]);
    if (marks.length !== questionIds.length) return res.status(400).json({ error: 'One or more selected questions are unavailable.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [contest] = await connection.execute(`INSERT INTO coding_contests
        (owner_id,title,description,status,duration_minutes,starts_at,ends_at)
        VALUES (?,?,?,'published',?,?,?)`, [
        req.session.user.id, title, description, durationMinutes,
        startsAt ? mysqlLocalDateTime(startsAt) : null,
        endsAt ? mysqlLocalDateTime(endsAt) : null
      ]);
      for (const [index, question] of questionRows.entries()) {
        await connection.execute('INSERT INTO coding_contest_questions (contest_id,challenge_id,points,order_index) VALUES (?,?,?,?)', [
          contest.insertId, Number(question.challengeId), Number(question.points), index
        ]);
      }
      await connection.commit();
      res.status(201).json({ ok: true, contestId: contest.insertId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }));

  router.get('/challenges/:id/discussions', requireAuth, asyncRoute(async (req, res) => {
    const challengeId = Number(req.params.id);
    const questions = await query(`SELECT id FROM coding_challenges WHERE id=? AND status='published'
      AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=coding_challenges.id AND tc.visibility='hidden')`, [challengeId]);
    if (!questions.length) return res.status(404).json({ error: 'Question not found.' });
    const posts = await query(`SELECT d.id,d.parent_id,d.body,d.created_at,d.user_id,u.name author_name,u.role author_role
      FROM coding_discussions d JOIN users u ON u.id=d.user_id
      WHERE d.challenge_id=? AND d.is_hidden=0 ORDER BY d.created_at ASC LIMIT 200`, [challengeId]);
    res.json({ posts });
  }));

  router.post('/challenges/:id/discussions', requireAuth, asyncRoute(async (req, res) => {
    const challengeId = Number(req.params.id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const parentId = req.body?.parentId == null ? null : Number(req.body.parentId);
    if (!Number.isSafeInteger(challengeId) || challengeId <= 0 || body.length < 2 || body.length > 3000 ||
        (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0))) {
      return res.status(400).json({ error: 'Enter a discussion post (2–3,000 characters) and a valid reply identifier.' });
    }
    const questions = await query(`SELECT id FROM coding_challenges WHERE id=? AND status='published'
      AND EXISTS (SELECT 1 FROM coding_test_cases tc WHERE tc.challenge_id=coding_challenges.id AND tc.visibility='hidden')`, [challengeId]);
    if (!questions.length) return res.status(404).json({ error: 'Question not found.' });
    if (parentId !== null) {
      const parent = await query('SELECT id FROM coding_discussions WHERE id=? AND challenge_id=? AND is_hidden=0', [parentId, challengeId]);
      if (!parent.length) return res.status(404).json({ error: 'Discussion to reply to was not found.' });
    }
    const result = await query('INSERT INTO coding_discussions (challenge_id,user_id,parent_id,body) VALUES (?,?,?,?)', [challengeId, req.session.user.id, parentId, body]);
    res.status(201).json({ post: { id: result.insertId, challenge_id: challengeId, parent_id: parentId, user_id: req.session.user.id, body } });
  }));

  router.delete('/discussions/:id', requireAuth, asyncRoute(async (req, res) => {
    const discussionId = Number(req.params.id);
    if (!Number.isSafeInteger(discussionId) || discussionId <= 0) return res.status(404).json({ error: 'Discussion not found.' });
    const result = req.session.user.role === 'trainer'
      ? await query('UPDATE coding_discussions SET is_hidden=1 WHERE id=? AND is_hidden=0', [discussionId])
      : await query('UPDATE coding_discussions SET is_hidden=1 WHERE id=? AND user_id=? AND is_hidden=0', [discussionId, req.session.user.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Discussion not found or you cannot remove it.' });
    res.json({ ok: true });
  }));

  router.get('/submissions/history', requireAuth, asyncRoute(async (req, res) => {
    const challengeId = req.query.challengeId ? Number(req.query.challengeId) : null;
    if (challengeId !== null && (!Number.isSafeInteger(challengeId) || challengeId <= 0)) return res.status(400).json({ error: 'Invalid challenge identifier.' });
    const rows = await query(`SELECT s.id,s.challenge_id,c.title challenge_title,s.status,s.tests_passed,s.total_tests,s.pass_percentage,
      s.compilation_status,s.execution_status,s.execution_time_ms,s.created_at
      FROM coding_assessment_submissions s JOIN coding_challenges c ON c.id=s.challenge_id
      WHERE s.user_id=? ${challengeId ? 'AND s.challenge_id=?' : ''}
      ORDER BY s.created_at DESC LIMIT 30`, challengeId ? [req.session.user.id, challengeId] : [req.session.user.id]);
    res.json({ submissions: rows });
  }));

  router.get('/submissions/:id', requireAuth, asyncRoute(async (req, res) => {
    const rows = await query(`SELECT id,challenge_id,status,tests_passed,total_tests,pass_percentage,compilation_status,execution_status,execution_time_ms,created_at
      FROM coding_assessment_submissions WHERE id=? AND user_id=?`, [Number(req.params.id), req.session.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Submission not found.' });
    const publicResults = await query(`SELECT test_index,passed,result_status,execution_time_ms FROM coding_test_results
      WHERE submission_id=? AND visibility='public' ORDER BY test_index`, [rows[0].id]);
    res.json({ submission: rows[0], publicResults });
  }));

  router.get('/trainer/coding-questions', requireTrainer, asyncRoute(async (req, res) => {
    const rows = await query(`SELECT cc.id,cc.title,cc.difficulty,cc.prompt,cc.status,c.title concept_title,
      (SELECT COUNT(*) FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='public') public_test_count,
      (SELECT COUNT(*) FROM coding_test_cases tc WHERE tc.challenge_id=cc.id AND tc.visibility='hidden') hidden_test_count
      FROM coding_challenges cc JOIN concepts c ON c.id=cc.concept_id WHERE cc.owner_id=? ORDER BY cc.id DESC`, [req.session.user.id]);
    res.json({ questions: rows });
  }));

  router.get('/trainer/challenges/:id', requireTrainer, asyncRoute(async (req, res) => {
    const rows = await query(`SELECT id,concept_id,title,difficulty,prompt,starter_code,estimated_minutes,time_limit_ms,memory_limit_mb,marks,hints_json,status
      FROM coding_challenges WHERE id=? AND owner_id=?`, [Number(req.params.id), req.session.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coding question not found.' });
    const [tests, concepts] = await Promise.all([
      loadTestCases(Number(req.params.id)),
      query('SELECT concept_id,relation_type FROM coding_challenge_concepts WHERE challenge_id=?', [Number(req.params.id)])
    ]);
    const question = rows[0];
    res.json({ question: {
      id: Number(question.id), conceptId: Number(question.concept_id), title: question.title, difficulty: question.difficulty,
      prompt: question.prompt, starterCode: question.starter_code, minutes: question.estimated_minutes,
      timeLimitMs: question.time_limit_ms, memoryLimitMb: question.memory_limit_mb, marks: question.marks, status: question.status,
      hints: parseJson(question.hints_json), publicTests: tests.filter(test => test.visibility === 'public').map(publicTest),
      hiddenTests: tests.filter(test => test.visibility === 'hidden').map(publicTest),
      tagConceptIds: concepts.filter(item => item.relation_type === 'tag').map(item => Number(item.concept_id)),
      prerequisiteConceptIds: concepts.filter(item => item.relation_type === 'prerequisite').map(item => Number(item.concept_id))
    } });
  }));

  async function saveTrainerQuestion(req, res, isUpdate) {
    let question;
    try { question = validateQuestion(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    const conceptsExist = await verifyConceptIds([...new Set([question.conceptId, ...question.tags, ...question.prerequisites])]);
    if (!conceptsExist) return res.status(400).json({ error: 'One or more selected concepts do not exist.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let challengeId;
      if (isUpdate) {
        const [owned] = await connection.execute('SELECT id FROM coding_challenges WHERE id=? AND owner_id=? FOR UPDATE', [Number(req.params.id), req.session.user.id]);
        if (!owned.length) {
          await connection.rollback();
          return res.status(404).json({ error: 'Coding question not found.' });
        }
        challengeId = Number(owned[0].id);
        await connection.execute(`UPDATE coding_challenges SET concept_id=?,title=?,difficulty=?,prompt=?,starter_code=?,estimated_minutes=?,
          time_limit_ms=?,memory_limit_mb=?,marks=?,hints_json=?,status=? WHERE id=? AND owner_id=?`, [
          question.conceptId, question.title, question.difficulty, question.prompt, question.starterCode, question.minutes,
          question.timeLimitMs, question.memoryLimitMb, question.marks, JSON.stringify(question.hints), question.status,
          challengeId, req.session.user.id
        ]);
      } else {
        const [created] = await connection.execute(`INSERT INTO coding_challenges
          (owner_id,concept_id,title,difficulty,prompt,starter_code,solution_keywords_json,solution_notes,estimated_minutes,time_limit_ms,memory_limit_mb,marks,hints_json,status)
          VALUES (?,?,?,?,?,?,JSON_ARRAY(),'',?,?,?,?,?,?)`, [
          req.session.user.id, question.conceptId, question.title, question.difficulty, question.prompt, question.starterCode,
          question.minutes, question.timeLimitMs, question.memoryLimitMb, question.marks, JSON.stringify(question.hints), question.status
        ]);
        challengeId = Number(created.insertId);
      }
      await replaceRelatedData(connection, challengeId, question);
      await connection.commit();
      res.status(isUpdate ? 200 : 201).json({ ok: true, challengeId, message: question.status === 'published' ? 'Coding question published.' : 'Draft saved.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  router.post('/trainer/challenges', requireTrainer, asyncRoute(async (req, res) => saveTrainerQuestion(req, res, false)));
  router.put('/trainer/challenges/:id', requireTrainer, asyncRoute(async (req, res) => saveTrainerQuestion(req, res, true)));
  router.delete('/trainer/challenges/:id', requireTrainer, asyncRoute(async (req, res) => {
    const result = await query('DELETE FROM coding_challenges WHERE id=? AND owner_id=?', [Number(req.params.id), req.session.user.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Coding question not found.' });
    res.json({ ok: true });
  }));

  return router;
}
