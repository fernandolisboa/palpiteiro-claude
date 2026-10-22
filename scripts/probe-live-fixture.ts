import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { classifyStatusShort } from "@/lib/live/phase";
import { toNormalizedLiveState } from "@/lib/providers/live/api-football";
import {
  getFixturesByDate,
  getFixturesRaw,
  RAW_FIXTURES_MAX_IDS,
} from "@/lib/providers/sports-data/api-football/adapter";
import {
  envelopeErrorsAreEmpty,
  FixtureItemSchema,
} from "@/lib/providers/sports-data/api-football/schemas";
import {
  API_FOOTBALL_LEAGUE_IDS,
  currentSeason,
  SUPPORTED_LEAGUES,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

// Probe do payload real de `/fixtures?id=` (#600): busca o fixture CRU (sem Zod), grava
// em `.live-probes/` (gitignored) e imprime o que o parser ao vivo tira dele (status,
// minuto, gols, cartões, expulsões) + os headers de cota. Os arquivos gravados viram
// fixture de replay em lib/providers/live/__tests__.
//
//   pnpm probe:live --id 1234567
//   pnpm probe:live --league copa_libertadores --date 2026-10-23 --team Flamengo
//   pnpm probe:live --league brasileirao_a --date 2026-10-19 --only-red
//
// `--date` é o dia UTC do kickoff (o mesmo do caminho de produção). Custo: 1 request por
// lote de até 20 fixtures, +1 quando resolve por liga/dia. Não toca a The Odds API.

const OUT_DIR = ".live-probes";
const RED_CARD_DETAIL = /red card|second yellow/i;

type RawItem = {
  fixture?: { id?: number; status?: { short?: string; long?: string } };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  events?: Array<{
    time?: { elapsed?: number | null; extra?: number | null };
    team?: { id?: number | null; name?: string | null };
    player?: { id?: number | null; name?: string | null };
    type?: string;
    detail?: string | null;
    comments?: string | null;
  }>;
};

function usage(): never {
  console.error(
    "uso: --id <n>[,<n>...] | --league <liga> --date YYYY-MM-DD [--team <nome>] [--only-red]\n" +
      `ligas: ${SUPPORTED_LEAGUES.join(", ")}`
  );
  process.exit(2);
}

function hasRedCard(item: RawItem): boolean {
  return (item.events ?? []).some(
    (e) =>
      e.type?.toLowerCase() === "card" && RED_CARD_DETAIL.test(e.detail ?? "")
  );
}

async function resolveIds(
  league: SupportedLeague,
  date: string,
  team: string | undefined
): Promise<number[]> {
  // Temporada do dia pedido, não de hoje: senão um jogo de temporada anterior some.
  const fixtures = await getFixturesByDate(
    date,
    API_FOOTBALL_LEAGUE_IDS[league],
    currentSeason(league, new Date(`${date}T12:00:00Z`))
  );
  const needle = team?.toLowerCase();
  const picked = fixtures.filter(
    (f) =>
      needle === undefined ||
      f.teams.home.name.toLowerCase().includes(needle) ||
      f.teams.away.name.toLowerCase().includes(needle)
  );
  for (const f of picked) {
    console.log(
      `  ${f.fixture.id}: ${f.teams.home.name} x ${f.teams.away.name} ` +
        `(${f.fixture.date}, ${f.fixture.status.short})`
    );
  }
  return picked.map((f) => f.fixture.id);
}

// Por que o parser devolveu `red: null`: são justamente as falhas que o #600 procura.
function redNullReason(
  item: RawItem,
  parsedEvents: unknown[] | undefined
): string {
  if (item.events === undefined) return "sem events no payload";
  if (parsedEvents === undefined) {
    return "!! events veio no payload mas o schema descartou";
  }
  return "!! expulsão com team.id fora dos dois times";
}

function report(item: RawItem, receivedAt: Date): void {
  const home = item.teams?.home?.name ?? "?";
  const away = item.teams?.away?.name ?? "?";
  console.log(`\n── ${item.fixture?.id}: ${home} x ${away}`);

  const parsed = FixtureItemSchema.safeParse(item);
  if (!parsed.success) {
    console.log("  !! Zod rejeitou o item (o ao vivo devolveria null):");
    for (const issue of parsed.error.issues.slice(0, 10)) {
      console.log(`     ${issue.path.join(".")}: ${issue.message}`);
    }
    return;
  }
  const s = toNormalizedLiveState(parsed.data, receivedAt);
  console.log(
    `  status=${s.statusShort} (${item.fixture?.status?.long ?? "?"}, ` +
      `classe=${classifyStatusShort(s.statusShort)}) elapsed=${s.elapsed} extra=${s.extra}`
  );
  console.log(
    `  gols=${s.goals ? `${s.goals.home}-${s.goals.away}` : "null"} ` +
      `vermelhos=${s.red ? `${s.red.home}-${s.red.away}` : `null (${redNullReason(item, parsed.data.events)})`}`
  );
  if (item.events === undefined) {
    console.log("  events: AUSENTE no payload");
    return;
  }
  const cards = item.events.filter((e) => e.type?.toLowerCase() === "card");
  console.log(`  events: ${item.events.length} (cartões: ${cards.length})`);
  for (const e of cards) {
    const minute = `${e.time?.elapsed ?? "?"}${e.time?.extra ? `+${e.time.extra}` : ""}'`;
    const red = RED_CARD_DETAIL.test(e.detail ?? "") ? " <- EXPULSÃO" : "";
    console.log(
      `    ${minute} ${e.team?.name ?? "?"} (team.id=${e.team?.id ?? "null"}) ` +
        `${e.player?.name ?? "?"} (player.id=${e.player?.id ?? "null"}): ` +
        `type=${JSON.stringify(e.type)} detail=${JSON.stringify(e.detail)}` +
        (e.comments ? ` comments=${JSON.stringify(e.comments)}` : "") +
        red
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      league: { type: "string" },
      date: { type: "string" },
      team: { type: "string" },
      "only-red": { type: "boolean", default: false },
    },
  });
  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY não definida (.env.local)");
  }

  let ids: number[];
  if (values.id) {
    ids = values.id.split(",").map((v) => Number(v.trim()));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) usage();
  } else if (values.league && values.date) {
    if (!(SUPPORTED_LEAGUES as readonly string[]).includes(values.league)) {
      usage();
    }
    console.log(`Fixtures de ${values.league} em ${values.date} (UTC):`);
    ids = await resolveIds(
      values.league as SupportedLeague,
      values.date,
      values.team
    );
  } else {
    usage();
  }
  if (ids.length === 0) {
    console.log("Nenhum fixture encontrado.");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (let i = 0; i < ids.length; i += RAW_FIXTURES_MAX_IDS) {
    const batch = ids.slice(i, i + RAW_FIXTURES_MAX_IDS);
    const raw = await getFixturesRaw(batch);
    console.log(
      `\nHTTP ${raw.statusCode}, cota: ${JSON.stringify(raw.quotaHeaders)}`
    );
    if (raw.bodyText !== null) {
      console.log(`  !! corpo não é JSON: ${raw.bodyText}`);
      return;
    }
    const body = (raw.body ?? {}) as {
      errors?: string[] | Record<string, string>;
      response?: RawItem[];
    };
    if (body.errors && !envelopeErrorsAreEmpty(body.errors)) {
      // Erro de conta/parâmetro se repete nos próximos lotes: para antes de gastar mais.
      console.log(`  !! errors no envelope: ${JSON.stringify(body.errors)}`);
      return;
    }
    const stamp = raw.receivedAt.toISOString().replace(/[-:]|\.\d+/g, "");
    for (const item of body.response ?? []) {
      report(item, raw.receivedAt);
      if (values["only-red"] && !hasRedCard(item)) continue;
      const file = join(OUT_DIR, `${item.fixture?.id ?? "x"}-${stamp}.json`);
      writeFileSync(
        file,
        JSON.stringify(
          {
            probedAt: raw.receivedAt.toISOString(),
            statusCode: raw.statusCode,
            quotaHeaders: raw.quotaHeaders,
            item,
          },
          null,
          2
        )
      );
      console.log(`  gravado: ${file}`);
    }
  }
}

main().catch((err) => {
  console.error("Probe falhou:");
  console.error(err);
  process.exit(1);
});
