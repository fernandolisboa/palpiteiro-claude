--> ADR 0027 / #231: ai_calls.provider pgEnum("ai_provider") -> text validado-na-app.
--> Hand-edit (ver plano-portao): drizzle gerou na ordem arriscada (trocar o tipo ANTES
--> de dropar o default tipado-pelo-enum, e sem USING). Reordenado pro padrao seguro:
--> (1) DROP DEFAULT (remove o default 'anthropic'::ai_provider), (2) SET DATA TYPE text
--> USING provider::text (cast explicito enum->text), (3) re-SET DEFAULT text, (4) DROP
--> TYPE (o enum nao e mais referenciado). Data-preserving: toda row ja e 'anthropic'.
ALTER TABLE "ai_calls" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "provider" SET DATA TYPE text USING "provider"::text;--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "provider" SET DEFAULT 'anthropic';--> statement-breakpoint
DROP TYPE "public"."ai_provider";
