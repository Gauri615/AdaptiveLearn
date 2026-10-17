import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOutput, javaSandboxStatus } from './javaSandbox.js';
import { publicRunSummary, safePublicTestResults, studentSubmissionSummary } from './assessmentResults.js';

test('exact output comparison preserves whitespace', () => {
  assert.equal(compareOutput('42\n', '42\n', 'exact'), true);
  assert.equal(compareOutput('42\n', '42', 'exact'), false);
});

test('trim comparison ignores outer whitespace only', () => {
  assert.equal(compareOutput(' 42 \n', '42', 'trim'), true);
  assert.equal(compareOutput('4 2', '42', 'trim'), false);
});

test('token comparison ignores whitespace between tokens', () => {
  assert.equal(compareOutput('1  2\n3', '1\n2 3', 'tokens'), true);
});

test('sandbox status is explicitly disabled until configured', async () => {
  const original = process.env.JAVA_EXECUTION_ENABLED;
  delete process.env.JAVA_EXECUTION_ENABLED;
  try {
    assert.deepEqual(await javaSandboxStatus(), { configured: false, operational: false, status: 'not_configured' });
  } finally {
    if (original === undefined) delete process.env.JAVA_EXECUTION_ENABLED;
    else process.env.JAVA_EXECUTION_ENABLED = original;
  }
});

test('student-safe result summaries never contain hidden input or expected output', () => {
  const results = [
    { index: 1, test: { visibility: 'public', input_data: 'sample input', expected_output: 'sample output' }, passed: true, status: 'passed', stdout: 'sample output', stderr: '', executionTimeMs: 4 },
    { index: 2, test: { visibility: 'hidden', input_data: 'private-input-marker', expected_output: 'private-output-marker' }, passed: false, status: 'wrong_answer', stdout: 'private-actual-marker', stderr: 'private-error-marker', executionTimeMs: 5 }
  ];
  const safeRun = publicRunSummary({ results, overallStatus: 'Accepted', passedCount: 1, totalCount: 2, passPercentage: 50 });
  const safeSubmission = studentSubmissionSummary(1, 2, { results, overallStatus: 'Wrong Answer', passedCount: 1, totalCount: 2, passPercentage: 50 }, 'Wrong Answer: 1 of 2 tests passed.');
  const payload = JSON.stringify({ safeRun, safeSubmission, publicResults: safePublicTestResults(results) });
  assert.match(payload, /sample input/);
  assert.doesNotMatch(payload, /private-(input|output|actual|error)-marker/);
  assert.equal(safeRun.assessmentStatus, 'Not Assessed');
  assert.equal(safeRun.status, 'Public Samples Passed');
  assert.equal(safeRun.totalCount, 1);
  assert.equal(safeRun.passedCount, 1);
});
