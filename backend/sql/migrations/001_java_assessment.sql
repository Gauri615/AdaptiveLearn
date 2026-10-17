USE adaptix_ai;

ALTER TABLE coding_challenges
  ADD COLUMN owner_id BIGINT UNSIGNED NULL,
  ADD COLUMN status ENUM('draft','published') NOT NULL DEFAULT 'published',
  ADD COLUMN time_limit_ms INT UNSIGNED NOT NULL DEFAULT 2000,
  ADD COLUMN memory_limit_mb INT UNSIGNED NOT NULL DEFAULT 256,
  ADD COLUMN marks INT UNSIGNED NOT NULL DEFAULT 100,
  ADD COLUMN hints_json JSON NULL,
  ADD INDEX idx_coding_challenge_owner_status (owner_id, status),
  ADD CONSTRAINT fk_challenge_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE coding_test_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  challenge_id BIGINT UNSIGNED NOT NULL,
  visibility ENUM('public','hidden') NOT NULL,
  input_data MEDIUMTEXT NOT NULL,
  expected_output MEDIUMTEXT NOT NULL,
  comparison_rule ENUM('exact','trim','tokens') NOT NULL DEFAULT 'trim',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_test_cases_question_visibility (challenge_id, visibility, id),
  CONSTRAINT fk_test_case_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE coding_challenge_concepts (
  challenge_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NOT NULL,
  relation_type ENUM('tag','prerequisite') NOT NULL,
  PRIMARY KEY (challenge_id, concept_id, relation_type),
  INDEX idx_challenge_concepts_concept (concept_id, relation_type),
  CONSTRAINT fk_challenge_concept_question FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_concept_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE coding_assessment_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NOT NULL,
  legacy_submission_id BIGINT UNSIGNED NULL UNIQUE,
  source_code MEDIUMTEXT NOT NULL,
  status VARCHAR(40) NOT NULL,
  tests_passed INT UNSIGNED NOT NULL DEFAULT 0,
  total_tests INT UNSIGNED NOT NULL DEFAULT 0,
  pass_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  compilation_status VARCHAR(30) NOT NULL,
  execution_status VARCHAR(40) NOT NULL,
  execution_time_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coding_assessment_user_date (user_id, created_at),
  INDEX idx_coding_assessment_question (challenge_id, created_at),
  CONSTRAINT fk_coding_assessment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_assessment_question FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_assessment_legacy FOREIGN KEY (legacy_submission_id) REFERENCES code_submissions(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE coding_test_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id BIGINT UNSIGNED NOT NULL,
  test_case_id BIGINT UNSIGNED NULL,
  test_index INT UNSIGNED NOT NULL,
  visibility ENUM('public','hidden') NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  result_status VARCHAR(40) NOT NULL,
  execution_time_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coding_test_results_submission (submission_id, visibility, test_index),
  CONSTRAINT fk_coding_test_result_submission FOREIGN KEY (submission_id) REFERENCES coding_assessment_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_test_result_case FOREIGN KEY (test_case_id) REFERENCES coding_test_cases(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE coding_concept_evidence (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NULL,
  attempt_number INT UNSIGNED NOT NULL,
  tests_passed INT UNSIGNED NOT NULL DEFAULT 0,
  total_tests INT UNSIGNED NOT NULL DEFAULT 0,
  compilation_failed TINYINT(1) NOT NULL DEFAULT 0,
  runtime_failed TINYINT(1) NOT NULL DEFAULT 0,
  incorrect_submission TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coding_evidence_submission_concept (submission_id, concept_id),
  INDEX idx_coding_evidence_user_concept (user_id, concept_id, created_at),
  CONSTRAINT fk_coding_evidence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_evidence_submission FOREIGN KEY (submission_id) REFERENCES coding_assessment_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_evidence_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE SET NULL
) ENGINE=InnoDB;
