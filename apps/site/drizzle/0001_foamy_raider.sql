ALTER TABLE `episodes` ADD `style_preference` text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE `owner_settings` ADD `style_preference` text DEFAULT 'balanced' NOT NULL;