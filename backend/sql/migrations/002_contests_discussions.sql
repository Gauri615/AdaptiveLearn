USE adaptix_ai;

ALTER TABLE coding_assessment_submissions
  ADD COLUMN contest_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_coding_assessment_contest (contest_id, user_id, created_at);

CREATE TABLE coding_contests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coding_contests_status_time (status, starts_at, ends_at),
  CONSTRAINT fk_coding_contest_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE coding_assessment_submissions
  ADD CONSTRAINT fk_coding_assessment_contest
  FOREIGN KEY (contest_id) REFERENCES coding_contests(id) ON DELETE SET NULL;

CREATE TABLE coding_contest_questions (
  contest_id BIGINT UNSIGNED NOT NULL,
  challenge_id BIGINT UNSIGNED NOT NULL,
  points INT UNSIGNED NOT NULL DEFAULT 100,
  order_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, challenge_id),
  INDEX idx_contest_questions_challenge (challenge_id),
  CONSTRAINT fk_contest_question_contest FOREIGN KEY (contest_id) REFERENCES coding_contests(id) ON DELETE CASCADE,
  CONSTRAINT fk_contest_question_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE coding_contest_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contest_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,
  UNIQUE KEY uq_coding_contest_entry (contest_id, user_id),
  INDEX idx_coding_contest_entry_user (user_id, started_at),
  CONSTRAINT fk_contest_entry_contest FOREIGN KEY (contest_id) REFERENCES coding_contests(id) ON DELETE CASCADE,
  CONSTRAINT fk_contest_entry_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE coding_discussions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  challenge_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coding_discussion_question (challenge_id, is_hidden, created_at),
  INDEX idx_coding_discussion_parent (parent_id, created_at),
  CONSTRAINT fk_coding_discussion_challenge FOREIGN KEY (challenge_id) REFERENCES coding_challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_discussion_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_coding_discussion_parent FOREIGN KEY (parent_id) REFERENCES coding_discussions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
