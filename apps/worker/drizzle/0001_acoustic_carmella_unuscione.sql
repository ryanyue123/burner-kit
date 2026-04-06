CREATE TABLE `email_account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`provider_token` text NOT NULL,
	`domain` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_account_email_unique` ON `email_account` (`email`);--> statement-breakpoint
CREATE INDEX `email_account_userId_idx` ON `email_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`email_account_id` text NOT NULL,
	`from_address` text NOT NULL,
	`subject` text,
	`text_content` text,
	`html_content` text,
	`received_at` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`email_account_id`) REFERENCES `email_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_message_accountId_idx` ON `email_message` (`email_account_id`);