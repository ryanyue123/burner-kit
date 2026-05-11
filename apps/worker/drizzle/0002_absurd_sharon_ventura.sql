ALTER TABLE `email_message` ADD `extracted_code` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `extraction_status` text DEFAULT 'pending' NOT NULL;