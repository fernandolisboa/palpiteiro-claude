import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { matches } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set — create .env.local from .env.example");
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { casing: "snake_case" });

async function main() {
  console.log("Seeding database...");

  // Usuários agora vêm do login real (Auth.js + whitelist, #12) — sem admin
  // placeholder no seed. Em prod, a row do dev user é reivindicada uma vez via
  // db/scripts/claim-admin.ts.

  const kickoff = new Date();
  kickoff.setUTCDate(kickoff.getUTCDate() + 7);
  kickoff.setUTCHours(19, 0, 0, 0);

  const [match] = await db
    .insert(matches)
    .values({
      externalId: "seed-brasileirao-001",
      league: "brasileirao_a",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
      kickoffAt: kickoff,
      status: "scheduled",
    })
    .onConflictDoNothing({ target: matches.externalId })
    .returning();

  if (match) {
    console.log(`  ✓ inserted match ${match.homeTeam} vs ${match.awayTeam}`);
  } else {
    console.log("  · sample match already present, skipped");
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
