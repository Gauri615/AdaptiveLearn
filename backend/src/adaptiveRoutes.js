import express from 'express';
import { query } from './db.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const asNumber = value => Number(value || 0);

function masteryLabel(score, attempts, independent) {
  if (!attempts) return 'Not Assessed';
  if (attempts < 3 || independent < 1) return 'Developing';
  if (score >= 80 && independent >= 2) return 'Verified Mastery';
  if (score >= 65) return 'Provisional Mastery';
  return 'Developing';
}

export function createAdaptiveRouter({ requireAuth, requireTrainer }) {
  const router = express.Router();

  router.get('/learning/profile', requireAuth, asyncRoute(async (req, res) => {
    const uid = req.session.user.id;
    const rows = await query(`
      SELECT c.id AS concept_id, c.title, c.slug,
        COALESCE(m.mastery_score, 0) AS mastery_score,
        COALESCE(m.attempts, 0) AS attempts,
        COALESCE(m.correct_count, 0) AS correct_count,
        COALESCE(m.last_evidence, 'not_assessed') AS last_evidence,
        (SELECT COUNT(*) FROM mastery_assessments ma
          WHERE ma.user_id = ? AND ma.concept_id = c.id AND ma.assessment_type = 'verification' AND ma.passed = 1) AS independent_passes,
        (SELECT COUNT(*) FROM hint_interactions hi
          JOIN coding_challenges cc ON cc.id = hi.challenge_id
          WHERE hi.user_id = ? AND cc.concept_id = c.id) AS hints_used,
        (SELECT MAX(cas.created_at) FROM coding_assessment_submissions cas
          JOIN coding_challenges cc2 ON cc2.id = cas.challenge_id
          WHERE cas.user_id = ? AND cc2.concept_id = c.id) AS last_practice
      FROM concepts c
      LEFT JOIN student_concept_mastery m ON m.concept_id = c.id AND m.user_id = ?
      ORDER BY c.order_index, c.title`, [uid, uid, uid, uid]);
    const skills = rows.map(r => {
      const score = asNumber(r.mastery_score);
      return { ...r, mastery_score: score, attempts: asNumber(r.attempts), correct_count: asNumber(r.correct_count),
        independent_passes: asNumber(r.independent_passes), hints_used: asNumber(r.hints_used),
        status: masteryLabel(score, asNumber(r.attempts), asNumber(r.independent_passes)),
        evidence: asNumber(r.attempts) ? `${r.correct_count} correct out of ${r.attempts} recorded diagnostic attempts` : 'No assessment evidence yet' };
    });
    res.json({ skills, scoring: { minimumAttemptsForVerification: 3, independentPassesForVerification: 2, note: 'Mastery is an evidence-based estimate, not a measure of intelligence. Verification requires repeated evidence and independent challenge success.' } });
  }));

  router.get('/learning/recommendation', requireAuth, asyncRoute(async (req, res) => {
    const uid = req.session.user.id;
    const rows = await query(`
      SELECT c.id AS concept_id, c.title AS concept_title, c.description AS concept_description,
        COALESCE(m.mastery_score, 0) AS mastery_score, COALESCE(m.attempts, 0) AS attempts,
        (SELECT COUNT(*) FROM coding_assessment_submissions s WHERE s.user_id = ? AND s.challenge_id = ch.id) AS attempts_on_question,
        (SELECT MAX(s2.created_at) FROM coding_assessment_submissions s2 WHERE s2.user_id = ? AND s2.challenge_id = ch.id) AS last_attempt,
        (SELECT s3.status FROM coding_assessment_submissions s3 WHERE s3.user_id = ? AND s3.challenge_id = ch.id ORDER BY s3.created_at DESC LIMIT 1) AS last_status,
        ch.id AS challenge_id, ch.title AS challenge_title, ch.difficulty, ch.prompt
      FROM coding_challenges ch
      JOIN concepts c ON c.id = ch.concept_id
      LEFT JOIN student_concept_mastery m ON m.user_id = ? AND m.concept_id = c.id
      WHERE (ch.status = 'published' OR ch.status IS NULL)
        AND NOT EXISTS (SELECT 1 FROM mastery_assessments ma WHERE ma.user_id = ? AND ma.challenge_id = ch.id AND ma.assessment_type = 'verification' AND ma.passed = 1)
      ORDER BY
        CASE WHEN COALESCE(m.attempts,0)=0 THEN 0 WHEN COALESCE(m.mastery_score,0)<50 THEN 1 WHEN COALESCE(m.mastery_score,0)<80 THEN 2 ELSE 3 END,
        CASE WHEN ch.difficulty='Easy' THEN 1 WHEN ch.difficulty='Medium' THEN 2 ELSE 3 END,
        attempts_on_question ASC, ch.id ASC LIMIT 1`, [uid, uid, uid, uid, uid]);
    if (!rows.length) return res.json({ recommendation: null, message: 'No eligible published questions are available yet. Ask a trainer to publish a reviewed question.' });
    const r = rows[0];
    let action = 'Practice a fundamentals question';
    let reason = 'This concept has little or no recorded evidence, so a baseline attempt is the most useful next step.';
    if (asNumber(r.attempts) > 0 && asNumber(r.mastery_score) < 50) {
      action = 'Revisit the concept and solve a similar question';
      reason = `Recorded mastery for ${r.concept_title} is ${asNumber(r.mastery_score)}%, so focused practice is recommended before increasing difficulty.`;
    } else if (asNumber(r.mastery_score) >= 50 && asNumber(r.mastery_score) < 80) {
      action = 'Strengthen the concept with another practice';
      reason = `Your current recorded estimate for ${r.concept_title} is ${asNumber(r.mastery_score)}%; another attempt will add evidence before progression.`;
    } else if (r.attempts_on_question > 0) {
      action = 'Try a different reviewed question';
      reason = 'This question has prior attempts in your history; a different challenge provides more useful evidence.';
    }
    res.json({ recommendation: { ...r, action, reason, href: `/coding?challenge=${r.challenge_id}`, evidence: { conceptAttempts: asNumber(r.attempts), priorQuestionAttempts: asNumber(r.attempts_on_question), latestStatus: r.last_status || null } } });
  }));

  router.post('/learning/hints', requireAuth, asyncRoute(async (req, res) => {
    const userId = req.session.user.id;
    const challengeId = Number(req.body.challengeId);
    const hintLevel = Number(req.body.hintLevel);
    if (!Number.isInteger(challengeId) || challengeId < 1 || !Number.isInteger(hintLevel) || hintLevel < 1 || hintLevel > 4) {
      return res.status(400).json({ error: 'A valid challengeId and hintLevel from 1 to 4 are required.' });
    }
    const owned = await query('SELECT id FROM coding_challenges WHERE id = ?', [challengeId]);
    if (!owned.length) return res.status(404).json({ error: 'Question not found.' });
    await query('INSERT INTO hint_interactions (user_id, challenge_id, hint_level) VALUES (?, ?, ?)', [userId, challengeId, hintLevel]);
    res.status(201).json({ recorded: true, hintLevel, note: 'Hint use is recorded as learning context, not treated as proof of low mastery.' });
  }));

  router.post('/learning/diagnosis-feedback', requireAuth, asyncRoute(async (req, res) => {
    const { submissionId, feedback, details } = req.body || {};
    const id = Number(submissionId);
    if (!Number.isInteger(id) || id < 1 || !['helpful','incorrect','uncertain'].includes(feedback)) {
      return res.status(400).json({ error: 'Provide a submissionId and feedback: helpful, incorrect, or uncertain.' });
    }
    const own = await query('SELECT id FROM coding_assessment_submissions WHERE id = ? AND user_id = ?', [id, req.session.user.id]);
    if (!own.length) return res.status(404).json({ error: 'Submission not found.' });
    await query('INSERT INTO diagnosis_feedback (user_id, submission_id, feedback, details) VALUES (?, ?, ?, ?)', [req.session.user.id, id, feedback, String(details || '').slice(0, 1000) || null]);
    res.status(201).json({ saved: true });
  }));

  router.post('/learning/tutor', requireAuth, asyncRoute(async (req, res) => {
    const { challengeId, code, mode = 'practice', question = '', compilerFeedback = '', failedPublicTests = [] } = req.body || {};
    if (!['beginner','practice','interview'].includes(mode)) return res.status(400).json({ error: 'Tutor mode must be beginner, practice, or interview.' });
    let challenge = null;
    if (challengeId) {
      const rows = await query('SELECT id, title, prompt, concept_id FROM coding_challenges WHERE id = ?', [Number(challengeId)]);
      challenge = rows[0] || null;
    }
    const observed = String(compilerFeedback || '').slice(0, 1200);
    const userQuestion = String(question || '').slice(0, 1000);
    const codeText = String(code || '').slice(0, 12000);
    let response;
    if (mode === 'beginner') response = `Let's break this down into smaller steps. ${challenge ? `For "${challenge.title}", first identify the input, expected output, and one small example.` : 'Start by identifying the input, expected output, and one small example.'} What is the simplest case your approach should handle?`;
    else if (mode === 'interview') response = `Explain your approach before changing the code: (1) What invariant or key observation does it rely on? (2) What are the time and space complexities? (3) Which boundary case could break it?${observed ? `\n\nObserved compiler feedback: ${observed}` : ''}`;
    else if (observed) response = `Let's use the available evidence first. The execution feedback says: "${observed}". Check the indicated line and form a hypothesis about the cause. ${failedPublicTests?.length ? 'Compare the public failing examples against your expected output.' : 'Try a minimal input that isolates the behaviour.'} What change would test your hypothesis?`;
    else if (userQuestion) response = `I can help you reason through that without jumping straight to a full solution. ${challenge ? `The current task is "${challenge.title}". ` : ''}Which part is unclear: understanding the requirement, choosing an approach, or checking an edge case?`;
    else response = `Try tracing your current approach with a tiny example. ${codeText ? 'Write down the value of each important variable after every loop iteration.' : 'Write a short plan in plain language before coding.'} Then test an empty or smallest valid input.`;
    res.json({ provider: 'rule-based-fallback', mode, response, evidenceUsed: { hasChallenge: Boolean(challenge), hasCode: Boolean(codeText), hasCompilerFeedback: Boolean(observed), publicFailureCount: Array.isArray(failedPublicTests) ? Math.min(failedPublicTests.length, 20) : 0 }, note: 'This response uses deterministic fallback guidance; no LLM provider is configured by this endpoint.' });
  }));

  router.post('/learning/verification/start', requireAuth, asyncRoute(async (req, res) => {
    const userId = req.session.user.id;
    const challengeId = Number(req.body.challengeId);
    if (!Number.isInteger(challengeId) || challengeId < 1) return res.status(400).json({ error: 'A valid challengeId is required.' });
    const rows = await query(`SELECT ch.id, ch.title, ch.concept_id FROM coding_challenges ch
      WHERE ch.id = ? AND (ch.status = 'published' OR ch.status IS NULL)`, [challengeId]);
    if (!rows.length) return res.status(404).json({ error: 'Published challenge not found.' });
    const original = rows[0];
    const variants = await query(`SELECT ch.id, ch.title, ch.difficulty, ch.concept_id
      FROM coding_challenges ch
      WHERE ch.concept_id = ? AND ch.id <> ? AND (ch.status = 'published' OR ch.status IS NULL)
        AND NOT EXISTS (SELECT 1 FROM coding_assessment_submissions s WHERE s.user_id = ? AND s.challenge_id = ch.id)
      ORDER BY CASE ch.difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, ch.id LIMIT 1`, [original.concept_id, original.id, userId]);
    if (!variants.length) return res.status(409).json({ error: 'No unseen, reviewed challenge for this concept is available. A trainer should author and publish an independent verification question.' });
    const chosen = variants[0];
    const inserted = await query(`INSERT INTO mastery_assessments (user_id, concept_id, challenge_id, assessment_type, passed, evidence_json)
      VALUES (?, ?, ?, 'verification', 0, JSON_OBJECT('state','started','originalChallengeId',?))`, [userId, original.concept_id, chosen.id, original.id]);
    res.status(201).json({ assessmentId: inserted.insertId, challenge: chosen, note: 'This is an independent challenge candidate selected from the existing reviewed question bank. Completion is not recorded until evaluated.' });
  }));

  router.get('/trainer/learning-summary', requireTrainer, asyncRoute(async (_req, res) => {
    const concepts = await query(`SELECT c.id, c.title, COUNT(DISTINCT m.user_id) AS students_assessed,
      ROUND(AVG(m.mastery_score),1) AS average_mastery,
      COUNT(DISTINCT CASE WHEN m.mastery_score < 50 THEN m.user_id END) AS learners_needing_practice
      FROM concepts c LEFT JOIN student_concept_mastery m ON m.concept_id = c.id
      GROUP BY c.id, c.title ORDER BY c.order_index, c.title`);
    res.json({ concepts });
  }));

  return router;
}
