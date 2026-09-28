-- Tour guiado (users.tour_state). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_state" text;
