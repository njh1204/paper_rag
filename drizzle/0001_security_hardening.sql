CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_sessions_expiry_idx`
  ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_nonces` (
  `nonce` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_nonces_expiry_idx`
  ON `sync_nonces` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `blob_objects` (
  `hash` text PRIMARY KEY NOT NULL,
  `size` integer NOT NULL,
  `mime` text NOT NULL,
  `created_at` integer NOT NULL
);
