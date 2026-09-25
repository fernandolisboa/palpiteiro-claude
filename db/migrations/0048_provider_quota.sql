-- IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre builds de preview (#509).
CREATE TABLE IF NOT EXISTS "provider_quota" (
	"provider" text PRIMARY KEY NOT NULL,
	"monthly_used" integer,
	"monthly_remaining" integer,
	"observed_at" timestamp with time zone NOT NULL
);
