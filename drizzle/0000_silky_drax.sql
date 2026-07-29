CREATE TABLE `auth_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`iterations` integer NOT NULL,
	`session_epoch` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`failures` integer NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_files` (
	`generation` integer NOT NULL,
	`path` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`mtime` integer NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`listed` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`generation`, `path`)
);
--> statement-breakpoint
CREATE TABLE `vault_profiles` (
	`generation` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
