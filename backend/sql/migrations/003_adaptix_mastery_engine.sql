USE adaptix_ai;

CREATE TABLE IF NOT EXISTS hint_interactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NOT NULL,
  hint_level TINYINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hint_user_challenge_date (user_id, challenge_id, created_at),
  CONSTRAINT chk_hint_level CHECK (hint_level BETWEEN 1 AND 4),
  CONSTRAINT fk_hint_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_hint_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mastery_assessments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NOT NULL,
  assessment_type ENUM('verification','retention','baseline') NOT NULL DEFAULT 'verification',
  passed TINYINT(1) NOT NULL DEFAULT 0,
  evidence_json JSON NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_mastery_user_concept_type (user_id, concept_id, assessment_type, passed),
  INDEX idx_mastery_user_challenge (user_id, challenge_id, started_at),
  CONSTRAINT fk_mastery_assessment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mastery_assessment_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
  CONSTRAINT fk_mastery_assessment_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS diagnosis_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NOT NULL,
  feedback ENUM('helpful','incorrect','uncertain') NOT NULL,
  details VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_diagnosis_feedback_submission (submission_id, created_at),
  CONSTRAINT fk_diagnosis_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_diagnosis_feedback_submission FOREIGN KEY (submission_id) REFERENCES coding_assessment_submissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adaptive_recommendation_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NULL,
  concept_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  explanation VARCHAR(1000) NOT NULL,
  outcome ENUM('pending','completed','dismissed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adaptive_event_user_date (user_id, created_at),
  CONSTRAINT fk_adaptive_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_adaptive_event_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE SET NULL,
  CONSTRAINT fk_adaptive_event_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE SET NULL
) ENGINE=InnoDB;
