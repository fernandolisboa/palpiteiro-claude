-- Bolão entre amigos (#567, ADR 0054). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "friend_pool_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"bettor_name" text NOT NULL,
	"kind" "bet_leg_kind" NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "friend_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"title" text,
	"entry_amount_cents" integer,
	"manual_home_score" integer,
	"manual_away_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_pools_manual_score_check" CHECK (("friend_pools"."manual_home_score" IS NULL AND "friend_pools"."manual_away_score" IS NULL) OR ("friend_pools"."manual_home_score" IS NOT NULL AND "friend_pools"."manual_away_score" IS NOT NULL AND "friend_pools"."manual_home_score" >= 0 AND "friend_pools"."manual_away_score" >= 0)),
	CONSTRAINT "friend_pools_entry_amount_check" CHECK ("friend_pools"."entry_amount_cents" IS NULL OR "friend_pools"."entry_amount_cents" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_pool_entries" ADD CONSTRAINT "friend_pool_entries_pool_id_friend_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."friend_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_pools" ADD CONSTRAINT "friend_pools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_pools" ADD CONSTRAINT "friend_pools_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friend_pool_entries_pool_id_idx" ON "friend_pool_entries" USING btree ("pool_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friend_pools_user_id_created_at_idx" ON "friend_pools" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friend_pools_match_id_idx" ON "friend_pools" USING btree ("match_id");