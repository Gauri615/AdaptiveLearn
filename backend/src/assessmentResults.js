export function safePublicTestResults(results) {
  return results.filter(result => result.test.visibility === 'public').map(result => ({
    index: result.index,
    passed: result.passed,
    status: result.status,
    input: result.test.input_data,
    expectedOutput: result.test.expected_output,
    actualOutput: result.stdout,
    stderr: result.stderr,
    executionTimeMs: result.executionTimeMs
  }));
}

export function publicRunSummary(result) {
  const { results, overallStatus, ...summary } = result;
  const publicResults = safePublicTestResults(results);
  const publicPassed = publicResults.filter(item => item.passed).length;
  return {
    ...summary,
    passedCount: publicPassed,
    totalCount: publicResults.length,
    passPercentage: publicResults.length ? Math.round(publicPassed / publicResults.length * 100) : 0,
    status: overallStatus === 'Accepted' ? 'Public Samples Passed' : overallStatus,
    assessmentStatus: 'Not Assessed',
    publicResults
  };
}

export function studentSubmissionSummary(id, challengeId, result, feedback) {
  return {
    id,
    challenge_id: challengeId,
    status: result.overallStatus,
    testsPassed: result.passedCount,
    totalTests: result.totalCount,
    passPercentage: result.passPercentage,
    compilationStatus: result.compilationStatus,
    executionStatus: result.executionStatus,
    executionTimeMs: result.executionTimeMs,
    feedback,
    publicResults: safePublicTestResults(result.results)
  };
}
