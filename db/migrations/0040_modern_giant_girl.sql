CREATE TABLE "palpite_settlement_attempts" (
	"palpite_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "palpite_settlement_attempts" ADD CONSTRAINT "palpite_settlement_attempts_palpite_id_palpites_id_fk" FOREIGN KEY ("palpite_id") REFERENCES "public"."palpites"("id") ON DELETE cascade ON UPDATE no action;