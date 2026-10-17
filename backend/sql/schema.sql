CREATE DATABASE IF NOT EXISTS adaptix_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adaptix_ai;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','trainer') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS concepts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Java Foundations',
  level ENUM('Foundation','Core','Advanced') NOT NULL DEFAULT 'Foundation',
  order_index INT NOT NULL DEFAULT 0,
  estimated_minutes INT NOT NULL DEFAULT 15,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS concept_prerequisites (
  concept_id BIGINT UNSIGNED NOT NULL,
  prerequisite_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (concept_id, prerequisite_id),
  CONSTRAINT fk_cp_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_prerequisite FOREIGN KEY (prerequisite_id) REFERENCES concepts(id) ON DELETE CASCADE,
  CONSTRAINT chk_cp_not_self CHECK (concept_id <> prerequisite_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_concept_mastery (
  user_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NOT NULL,
  mastery_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  last_evidence VARCHAR(80) NOT NULL DEFAULT 'not_assessed',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, concept_id),
  CONSTRAINT fk_scm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_scm_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS diagnostic_questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  concept_id BIGINT UNSIGNED NOT NULL,
  question_type ENUM('conceptual','output','debugging','application') NOT NULL DEFAULT 'conceptual',
  question_text TEXT NOT NULL,
  options_json JSON NOT NULL,
  correct_answer VARCHAR(20) NOT NULL,
  explanation TEXT NOT NULL,
  difficulty ENUM('Easy','Medium','Hard') NOT NULL DEFAULT 'Easy',
  CONSTRAINT fk_dq_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_answers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  selected_answer VARCHAR(20),
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  response_seconds INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_answers_user_date (user_id, created_at),
  CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_question FOREIGN KEY (question_id) REFERENCES diagnostic_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recommendations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NOT NULL,
  action_type ENUM('revise','practice','debug','explain','advance') NOT NULL,
  title VARCHAR(180) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('recommended','started','completed','skipped') NOT NULL DEFAULT 'recommended',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_recommendations_user (user_id, status, created_at),
  CONSTRAINT fk_rec_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rec_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coding_challenges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  concept_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  difficulty ENUM('Easy','Medium','Hard') NOT NULL DEFAULT 'Easy',
  prompt TEXT NOT NULL,
  starter_code MEDIUMTEXT NOT NULL,
  solution_keywords_json JSON NOT NULL,
  solution_notes TEXT NOT NULL,
  estimated_minutes INT NOT NULL DEFAULT 20,
  CONSTRAINT fk_challenge_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS code_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NOT NULL,
  source_code MEDIUMTEXT NOT NULL,
  status ENUM('needs_work','structure_checks_passed','submitted_for_review') NOT NULL DEFAULT 'needs_work',
  session_key VARCHAR(100) NULL,
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_submissions_user (user_id, created_at),
  CONSTRAINT fk_submission_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS editor_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NULL,
  session_key VARCHAR(100) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_events_user_session (user_id, session_key, created_at),
  CONSTRAINT fk_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS code_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NULL,
  session_key VARCHAR(100) NOT NULL,
  label VARCHAR(80) NOT NULL DEFAULT 'Editor snapshot',
  source_code MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_snapshots_user_session (user_id, session_key, created_at),
  CONSTRAINT fk_snapshot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshot_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS integrity_review_signals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NULL,
  signal_type VARCHAR(60) NOT NULL,
  explanation TEXT NOT NULL,
  event_ids_json JSON NULL,
  review_status ENUM('not_reviewed','reviewed_no_concern','further_discussion_required') NOT NULL DEFAULT 'not_reviewed',
  trainer_note TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  INDEX idx_signal_status (review_status, created_at),
  CONSTRAINT fk_signal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_signal_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS viva_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NOT NULL,
  status ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  CONSTRAINT fk_viva_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_viva_submission FOREIGN KEY (submission_id) REFERENCES code_submissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS viva_questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  question_text TEXT NOT NULL,
  expected_keywords_json JSON NOT NULL,
  answer_text TEXT NULL,
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  feedback TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vq_session FOREIGN KEY (session_id) REFERENCES viva_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainer_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trainer_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  concept_id BIGINT UNSIGNED NULL,
  feedback TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tf_trainer FOREIGN KEY (trainer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tf_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tf_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE SET NULL
) ENGINE=InnoDB;
