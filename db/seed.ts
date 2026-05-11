import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { matches, users } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set — create .env.local from .env.example");
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { casing: "snake_case" });

async function main() {
  console.log("Seeding database...");

  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@palpiteiro.local",
      name: "Admin",
      role: "admin",
      allowed: true,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (admin) {
    console.log(`  ✓ inserted admin user ${admin.email}`);
  } else {
    console.log("  · admin user already present, skipped");
  }

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
