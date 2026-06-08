CREATE TABLE "pending_invites" (
	"email" text PRIMARY KEY NOT NULL,
	"invited_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;