import { config } from "dotenv";
config({ path: ".env.local" });

import { desc, eq } from "drizzle-orm";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { PredictError, predict } from "@/lib/ai/predict";

type CliArgs = {
  externalId: string;
  userId: string;
};

function parseArgs(): CliArgs {
  const args: Partial<CliArgs> = {};
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "externalId" && value) args.externalId = value;
    if (key === "userId" && value) args.userId = value;
  }
  if (!args.externalId || !args.userId) {
    throw new Error(
      "usage: pnpm tsx scripts/test-predict.ts --externalId=<api-football fixture id> --userId=<db uuid>",
    );
  }
  return { externalId: args.externalId, userId: args.userId };
}

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} not set — populate .env.local from .env.example`);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function resolveMatchId(externalId: string): Promise<string> {
  const rows = await db
    .select({ id: matches.id, kickoffAt: matches.kickoffAt, status: matches.status })
    .from(matches)
    .where(eq(matches.externalId, externalId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `no match found with external_id=${externalId}. Run the fixture sync first or pick a different fixture.`,
    );
  }
  console.log(
    `Resolved match: id=${row.id} kickoff=${row.kickoffAt.toISOString()} status=${row.status}`,
  );
  return row.id;
}

async function main() {
  const cli = parseArgs();
  requireEnv("DATABASE_URL");
  requireEnv("ANTHROPIC_API_KEY");
  requireEnv("API_FOOTBALL_KEY");
  requireEnv("ODDS_API_KEY");

  console.log("─── predict() smoke test ───");
  const matchId = await resolveMatchId(cli.externalId);

  console.log("\nCalling predict()…");
  try {
    // Smoke test: isAdmin=true permite exercitar qualquer modelo do registry
    // (a preferência do userId, se houver, não é filtrada por audiência aqui).
    const prediction = await predict({
      matchId,
      userId: cli.userId,
      isAdmin: true,
    });
    console.log("\n✓ Prediction persisted:");
    console.log(`  recommendation : ${prediction.recommendation}`);
    console.log(`  confidence_pct : ${prediction.confidencePct}`);
    console.log(`  edge_pct       : ${prediction.edgePct ?? "n/a"}`);
    console.log(`  minimum_odd    : ${prediction.minimumOdd ?? "n/a"}`);
    console.log(`  bookmaker      : ${prediction.bookmaker ?? "n/a"}`);
    console.log(`  odd@rec        : ${prediction.oddAtRecommendation ?? "n/a"}`);
    console.log(`  implied_pct    : ${prediction.impliedProbPct ?? "n/a"}`);
    console.log(`  rationale      : ${truncate(prediction.rationale, 240)}`);
    console.log(`  key_factors    :`);
    for (const f of prediction.keyFactors) {
      console.log(`    - ${truncate(f, 180)}`);
    }
  } catch (err) {
    if (err instanceof PredictError) {
      console.error(`\n✗ predict() failed: ${err.message}`);
      console.error("  context:", JSON.stringify(err.context, null, 2));
    } else {
      console.error("\n✗ Unexpected error:", err);
    }
    process.exitCode = 1;
  }

  console.log("\n─── Latest ai_calls row ───");
  const latestCall = await db
    .select({
      id: aiCalls.id,
      status: aiCalls.status,
      inputTokens: aiCalls.inputTokens,
      outputTokens: aiCalls.outputTokens,
      latencyMs: aiCalls.latencyMs,
      costUsd: aiCalls.costUsd,
      errorMessage: aiCalls.errorMessage,
      createdAt: aiCalls.createdAt,
    })
    .from(aiCalls)
    .where(eq(aiCalls.matchId, matchId))
    .orderBy(desc(aiCalls.createdAt))
    .limit(1);
  if (latestCall[0]) {
    const c = latestCall[0];
    console.log(
      `  status=${c.status} tokens=${c.inputTokens}/${c.outputTokens} ` +
        `latency=${c.latencyMs}ms cost=$${c.costUsd} created_at=${c.createdAt.toISOString()}`,
    );
    if (c.errorMessage) {
      console.log(`  error_message: ${truncate(c.errorMessage, 240)}`);
    }
  } else {
    console.log("  (no ai_calls rows for this match)");
  }

  console.log("\n─── Latest predictions row ───");
  const latestPrediction = await db
    .select({
      id: predictions.id,
      recommendation: predictions.recommendation,
      confidencePct: predictions.confidencePct,
      edgePct: predictions.edgePct,
      createdAt: predictions.createdAt,
    })
    .from(predictions)
    .where(eq(predictions.matchId, matchId))
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  if (latestPrediction[0]) {
    const p = latestPrediction[0];
    console.log(
      `  ${p.recommendation} conf=${p.confidencePct} edge=${p.edgePct ?? "n/a"} ` +
        `created_at=${p.createdAt.toISOString()}`,
    );
  } else {
    console.log("  (no predictions rows for this match)");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Smoke test failed:");
  console.error(err);
  process.exit(1);
});
