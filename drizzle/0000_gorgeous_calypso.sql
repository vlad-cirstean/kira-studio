CREATE TABLE `connection_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`node_kind` text NOT NULL,
	`pattern` text NOT NULL,
	`is_regex` integer DEFAULT false NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connection_filters_connection_id` ON `connection_filters` (`connection_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text NOT NULL,
	`mode` text NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`host` text,
	`port` integer,
	`database` text,
	`username` text,
	`password` text,
	`uri` text,
	`options_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metadata_cache` (
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	`etag` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_cache_connection_path` ON `metadata_cache` (`connection_id`,`path`);--> statement-breakpoint
CREATE TABLE `op_log` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`tab_id` text,
	`started_at` text NOT NULL,
	`duration_ms` integer,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`rows` integer,
	`command` text,
	`error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `op_log_started_at` ON `op_log` (`started_at`);--> statement-breakpoint
CREATE TABLE `saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_queries_connection_path` ON `saved_queries` (`connection_id`,`path`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`state_json` text NOT NULL,
	`order` integer NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tabs_order` ON `tabs` (`order`);--> statement-breakpoint
CREATE TABLE `ui_layout` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
