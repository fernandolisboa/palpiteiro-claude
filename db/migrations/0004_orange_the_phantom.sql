CREATE TABLE "ai_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_model_id" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD CONSTRAINT "ai_config_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "ai_config" ("id", "default_model_id") VALUES (1, 'claude-opus-4-8') ON CONFLICT ("id") DO NOTHING;