-- Dixon-Coles em produção (ADR 0051). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "team_rating_fits" (
	"league" "league" PRIMARY KEY NOT NULL,
	"home_advantage" double precision NOT NULL,
	"rho" double precision NOT NULL,
	"match_count" integer NOT NULL,
	"seasons" jsonb NOT NULL,
	"fitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_ratings" (
	"league" "league" NOT NULL,
	"team" text NOT NULL,
	"attack" double precision NOT NULL,
	"defence" double precision NOT NULL,
	"matches" integer NOT NULL,
	CONSTRAINT "team_ratings_league_team_pk" PRIMARY KEY("league","team")
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_dixon_coles" boolean DEFAULT true NOT NULL;