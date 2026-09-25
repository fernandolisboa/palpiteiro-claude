CREATE TABLE "league_settings" (
	"league" "league" PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Seed (ADR 0050): as ligas ativas de hoje, antes em ACTIVE_LEAGUES (lib/config/active-leagues.ts).
-- ON CONFLICT DO NOTHING: o DB de preview da Vercel é compartilhado — nunca sobrescreve um toggle já feito no admin.
INSERT INTO "league_settings" ("league", "active") VALUES
	('brasileirao_a', true),
	('champions_league', true)
ON CONFLICT ("league") DO NOTHING;--> statement-breakpoint
-- premier_league/la_liga entraram no enum na 0045. O migrator do Drizzle aplica todas as
-- migrations pendentes numa transação só, e o Postgres recusa usar um valor de enum adicionado
-- na mesma transação a um tipo que já existia (SQLSTATE 55P04). Isso só acontece num DB
-- EXISTENTE com 0045 e 0046 pendentes juntas (num DB novo o tipo nasce na mesma transação e o
-- seed entra). Aí o seed das duas é pulado (nascem desligadas; liga-se no /admin/leagues) em
-- vez de derrubar o deploy. Produção aplicou a 0045 no deploy do #507 (35855a2, READY).
DO $$
BEGIN
	INSERT INTO "league_settings" ("league", "active") VALUES
		('premier_league', true),
		('la_liga', true)
	ON CONFLICT ("league") DO NOTHING;
EXCEPTION WHEN unsafe_new_enum_value_usage THEN
	RAISE NOTICE 'league_settings: seed de premier_league/la_liga pulado (enum criado nesta transação)';
END $$;
