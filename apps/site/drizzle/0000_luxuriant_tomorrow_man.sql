CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`object_key` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer,
	`sha256` text,
	`duration_ms` integer,
	`multipart_state_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_object_unique` ON `assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `assets_episode_idx` ON `assets` (`owner_user_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `audio_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`job_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`script_version` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`cache_key` text NOT NULL,
	`asset_id` text,
	`duration_ms` integer,
	`provider_request_id` text,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_version_order_unique` ON `audio_chunks` (`episode_id`,`script_version`,`ordinal`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`script_version` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	`turns_json` text NOT NULL,
	`spoken_text` text NOT NULL,
	`source_ids_json` text DEFAULT '[]' NOT NULL,
	`start_ms` integer,
	`duration_ms` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_version_order_unique` ON `chapters` (`episode_id`,`script_version`,`ordinal`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversations_episode_idx` ON `conversations` (`owner_user_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`mode` text NOT NULL,
	`prompt` text NOT NULL,
	`source_notes` text DEFAULT '' NOT NULL,
	`source_urls_json` text DEFAULT '[]' NOT NULL,
	`requested_minutes` integer NOT NULL,
	`language` text NOT NULL,
	`freshness_hours` integer NOT NULL,
	`voice_profile` text NOT NULL,
	`interaction_enabled` integer NOT NULL,
	`persona_snapshot_json` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`cutoff_at` text,
	`script_version` integer DEFAULT 1 NOT NULL,
	`actual_duration_ms` integer,
	`final_asset_id` text,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `episodes_owner_cursor_idx` ON `episodes` (`owner_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `episodes_owner_state_idx` ON `episodes` (`owner_user_id`,`state`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`owner_user_id` text NOT NULL,
	`route` text NOT NULL,
	`key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`resource_id` text NOT NULL,
	`response_json` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_unique` ON `idempotency_keys` (`owner_user_id`,`route`,`key`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`next_run_at` text NOT NULL,
	`checkpoint_json` text DEFAULT '{}' NOT NULL,
	`lease_token` text,
	`fence` integer DEFAULT 0 NOT NULL,
	`lease_until` text,
	`heartbeat_at` text,
	`error_code` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_eligibility_idx` ON `jobs` (`state`,`next_run_at`,`lease_until`,`priority`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`anchor_ms` integer NOT NULL,
	`chapter_id` text,
	`asset_id` text,
	`source_ids_json` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_episode_order_idx` ON `messages` (`owner_user_id`,`episode_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `owner_settings` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`default_persona_id` text,
	`default_language` text DEFAULT 'English' NOT NULL,
	`default_minutes` integer DEFAULT 30 NOT NULL,
	`playback_speed` real DEFAULT 1 NOT NULL,
	`interaction_enabled` integer DEFAULT true NOT NULL,
	`auto_resume` integer DEFAULT true NOT NULL,
	`retain_recordings` integer DEFAULT false NOT NULL,
	`episode_budget_usd` real DEFAULT 5 NOT NULL,
	`answer_budget_usd` real DEFAULT 1 NOT NULL,
	`monthly_budget_usd` real DEFAULT 50 NOT NULL,
	`voice_usd_per_thousand_characters` real,
	`pricing_version` text DEFAULT '2026-10-11-owner-rate-v1' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`instructions` text NOT NULL,
	`tone` text NOT NULL,
	`pace` text NOT NULL,
	`voice_id` text,
	`voice_settings_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personas_owner_idx` ON `personas` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `playback_progress` (
	`owner_user_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`position_ms` integer NOT NULL,
	`speed` real NOT NULL,
	`device_session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_owner_episode_unique` ON `playback_progress` (`owner_user_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`reserved_usd` real NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_owner_state_idx` ON `reservations` (`owner_user_id`,`state`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`url` text NOT NULL,
	`publisher` text,
	`title` text,
	`published_at` text,
	`retrieved_at` text NOT NULL,
	`claims_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sources_episode_idx` ON `sources` (`owner_user_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`operation` text NOT NULL,
	`billable_units_json` text NOT NULL,
	`estimated_usd` real,
	`cost_status` text NOT NULL,
	`request_id` text,
	`pricing_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_owner_date_idx` ON `usage_events` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `voice_catalog` (
	`voice_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`preview_url` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
