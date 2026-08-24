-- Reviewer role: single username/password account, separate from PayPal admin auth.

CREATE TABLE `reviewer_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- password_plain lets the admin settings page redisplay the current reviewer
-- password (it has an eye-toggle + copy button for that). password_hash is
-- still the only thing checked at login time.
ALTER TABLE `reviewer_users` ADD COLUMN `password_plain` varchar(255) NULL AFTER `password_hash`;

CREATE TABLE `reviewer_sessions` (
  `token` varchar(64) NOT NULL,
  `reviewer_id` int NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token`),
  KEY `reviewer_id` (`reviewer_id`),
  CONSTRAINT `reviewer_sessions_ibfk_1` FOREIGN KEY (`reviewer_id`) REFERENCES `reviewer_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
