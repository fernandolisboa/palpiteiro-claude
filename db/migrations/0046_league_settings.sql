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
-- premier_league/la_liga entraram no enum na 0045. O Postgres recusa usar um valor de enum
-- adicionado na MESMA transação (SQLSTATE 55P04); se um migrator aplicar 0045+0046 numa
-- transação só num DB novo, o seed dessas duas é pulado (nascem desligadas, liga-se no
-- /admin/leagues) em vez de derrubar a migration. Em produção/preview a 0045 já foi
-- commitada num deploy anterior e o seed entra normalmente.
DO $$
BEGIN
	INSERT INTO "league_settings" ("league", "active") VALUES
		('premier_league', true),
		('la_liga', true)
	ON CONFLICT ("league") DO NOTHING;
EXCEPTION WHEN unsafe_new_enum_value_usage THEN
	RAISE NOTICE 'league_settings: seed de premier_league/la_liga pulado (enum criado nesta transação)';
END $$;
