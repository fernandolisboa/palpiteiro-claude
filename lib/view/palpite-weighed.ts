import { z } from "zod";

// Só o TIPO (apagado no build): a view não importa código de @/lib/ai, mesmo padrão do
// PalpiteHeadline em db/schema.ts.
import type { PalpiteWeighed } from "@/lib/ai/palpites/weighed";

// View model do "o que pesou" no palpite (#683, PLAN-683 §4). PURO e seguro no cliente.
// Lê `headline.pick.weighed` por Zod (o jsonb não tem schema no banco) e monta tudo o que
// o bloco desenha: as linhas dos fatores com as raias, a barra antes→depois com as tiras
// listradas e os fluxos dos arcos, o resumo e as frases pro leitor de tela. Os
// componentes só renderizam.
//
// FIREWALL (emenda da ADR 0030 §3): chances do 1X2 em pontos inteiros de 100 e pontos
// movidos por fator; nenhuma palavra de valor (odd, cotação, edge, EV, stake, R$...).
// "os preços do jogo" pode como palavra. O `%` só aparece nos rótulos da barra, que o
// componente marca com `data-pesou-pct`; aqui tudo é número puro.

export type OutcomeKey = "home" | "draw" | "away";
const OUTCOMES: readonly OutcomeKey[] = ["home", "draw", "away"];
type Triple = Record<OutcomeKey, number>;

export type WeighedTeams = {
  home: { name: string; short: string };
  away: { name: string; short: string };
};

export type WeighedMove = { from: OutcomeKey; to: OutcomeKey; pts: number };

export type WeighedLane = WeighedMove & {
  // Vaga na sequência da animação (0..7): raias de cima pra baixo, depois os arcos.
  slot: number;
  // Uma bolinha por ponto (até 4): posição final em px e atraso em s.
  dots: { to: number; delay: number }[];
  sr: string;
};

export type WeighedRow = {
  key: string;
  short: string;
  long: string;
  // Etiqueta do HERO: quem levou o fator ao valor final, quando não foi o JEV.
  tag: "user" | "news" | null;
  // Linha da origem no "Ver raciocínio".
  originLine: string;
  // Mexeu menos de 1 pt: fica na lista, esmaecido, sem raia.
  tiny: boolean;
  lanes: WeighedLane[];
};

export type WeighedSlice = {
  key: OutcomeKey;
  pts: number;
  // O "antes" quando mudou; null = igual.
  before: number | null;
  strong: boolean;
};

export type WeighedHatch = {
  // Em pontos (0–100) sobre a barra final, nunca em %.
  left: number;
  width: number;
  // Tom de quem recebeu e direção em que as listras andam.
  tint: OutcomeKey;
  dir: 1 | -1;
};

export type WeighedFlowGroup = {
  // Origem comum dos arcos de quem perdeu (pontos, 0–100).
  x0: number;
  dests: { x: number; pts: number; key: OutcomeKey; slot: number }[];
};

export type PalpiteWeighedView = {
  // Cor da fatia forte (data-winner no CSS): o resultado do palpite.
  winner: OutcomeKey;
  start: { prefix: string; text: string };
  rows: WeighedRow[];
  // Alguma raia chega no empate (a coluna do destino alarga).
  hasDrawLane: boolean;
  bar: {
    slices: WeighedSlice[];
    hatches: WeighedHatch[];
    flows: WeighedFlowGroup[];
    // Altura reservada pros arcos (px): 0 sem fluxo, 22 com um destino por lado, 32 com
    // dois. Sai daqui (sem largura) pro SSR já guardar a caixa.
    arcsHeight: 0 | 22 | 32;
  };
  labels: Record<OutcomeKey, { short: string; full: string }>;
  summary: {
    kind: "flip" | "same" | "none";
    icon: "flip" | "same";
    // Curto (HERO) em pedaços que não quebram por dentro; longo (diálogo).
    short: string[];
    long: string;
  };
  alsoRead: { label: string; text: string } | null;
  // Barra em palavras pro leitor de tela, sem %.
  sr: string;
};

// ─── Leitura (Zod) ───────────────────────────────────────────────────────────

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const triple = (min: number, max: number) =>
  z.object({ home: int(min, max), draw: int(min, max), away: int(min, max) });

const WeighedSchema = z.object({
  version: z.literal("palpite_weighed_v1"),
  baseOutcome: z.enum(OUTCOMES),
  basePts: triple(0, 100),
  finalPts: triple(0, 100),
  factors: z.array(
    z.object({
      key: z.string(),
      origin: z.string(),
      value: z.number().min(0).max(1),
      multiplier: z.number().positive().finite(),
      pts: triple(-100, 100),
    })
  ),
});

const PickSchema = z.object({
  outcome: z.enum(OUTCOMES),
  source: z.enum(["market", "dc_jev"]),
  weighed: WeighedSchema,
});

type ParsedWeighed = z.infer<typeof WeighedSchema>;

// Trava de compilação: o que o leitor espera é um subconjunto do que o gravador escreve.
type _WriterFits = PalpiteWeighed extends ParsedWeighed ? true : never;
const _writerFits: _WriterFits = true;
void _writerFits;

const sumOf = (t: Triple) => t.home + t.draw + t.away;

// As somas que a barra e as raias precisam: base e palpite fecham 100, cada fator fecha
// 0 e a soma dos fatores é a diferença da barra, resultado a resultado.
function closes(w: ParsedWeighed): boolean {
  if (sumOf(w.basePts) !== 100 || sumOf(w.finalPts) !== 100) return false;
  if (w.factors.some((f) => sumOf(f.pts) !== 0)) return false;
  return OUTCOMES.every(
    (k) =>
      w.factors.reduce((a, f) => a + f.pts[k], 0) ===
      w.finalPts[k] - w.basePts[k]
  );
}

// ─── Textos ──────────────────────────────────────────────────────────────────

// Limiares da folga da base, em pontos (afinar aqui).
export const LEAN_THRESHOLDS = { even: 2, clear: 13 } as const;
// "por pouco": folga final do palpite abaixo disto, em pontos.
export const NARROW_FINAL_GAP = 5;
// O narrador chama de "sinal forte" o noul ≥ 0,8 (STRONG_SIGNAL em
// lib/ai/markets/_narrator/labels.ts, não exportado): a mesma escala aqui.
const STRONG_SIGNAL = 0.8;
// Noul de uma afirmação confirmada pelos nossos dados (USER_NOUL.confirmed, também o da
// notícia: NEWS_NOUL = USER_NOUL). Conferido em teste.
export const CONFIRMED_NOUL = 0.85;

// Palavras da origem notícia: as mesmas do passo da C2 do #672 (PLAN-672 §8.1). Quem
// fizer merge por último troca por uma constante exportada de lá, se houver.
const NEWS_ORIGIN = {
  unverified: "segundo o ge (não conferido com os nossos dados)",
  confirmed: "segundo o ge (confirmado pelos nossos dados)",
};

const FACTOR_TEXT: Record<
  string,
  { short: (t: string) => string; long: (t: string) => string }
> = {
  attack_weakened: {
    short: (t) => `${t} sem peça no ataque`,
    long: (t) =>
      `Desfalques ou titulares poupados tiram do ${t} uma peça ofensiva central`,
  },
  defense_weakened: {
    short: (t) => `Defesa do ${t} desfalcada`,
    long: (t) => `Desfalques ou titulares poupados atingem a defesa do ${t}`,
  },
  rotation_risk: {
    short: (t) => `${t} vai poupar titulares`,
    long: (t) => `O ${t} tende a escalar um time poupado`,
  },
  high_stakes: {
    short: (t) => `Jogo de peso pro ${t}`,
    long: (t) => `Jogo de peso na tabela para o ${t}`,
  },
};

const OTHER_ADJUSTMENT = "Outro ajuste do modelo";

/** Frase do fator (curta no HERO, longa no diálogo); null = chave desconhecida. */
export function factorText(
  key: string,
  teams: WeighedTeams,
  size: "short" | "long"
): string | null {
  const m = /^(.+)_(home|away)$/.exec(key);
  const text = m ? FACTOR_TEXT[m[1]] : undefined;
  if (!m || !text) return null;
  return text[size](teams[m[2] as "home" | "away"].name);
}

/** Linha de origem do diálogo. */
export function originLine(origin: string, value: number): string {
  if (origin === "jev") {
    return `contexto do jogo (JEV) · sinal ${value >= STRONG_SIGNAL ? "forte" : "moderado"}`;
  }
  if (origin === "news") {
    return value >= CONFIRMED_NOUL
      ? NEWS_ORIGIN.confirmed
      : NEWS_ORIGIN.unverified;
  }
  if (origin === "user") {
    return value >= CONFIRMED_NOUL
      ? "você contou (conferido)"
      : "você contou (não conferido)";
  }
  return "ajuste do modelo";
}

function labelsOf(teams: WeighedTeams): PalpiteWeighedView["labels"] {
  return {
    home: { short: teams.home.short, full: teams.home.name },
    draw: { short: "empate", full: "empate" },
    away: { short: teams.away.short, full: teams.away.name },
  };
}

const ptsWord = (n: number) => (n === 1 ? "ponto" : "pontos");

// "do Atlético-MG" / "do empate"; "para o Boca Juniors" / "para o empate".
function laneSr(m: WeighedMove, labels: PalpiteWeighedView["labels"]): string {
  return `${m.pts} ${ptsWord(m.pts)} do ${labels[m.from].full} para o ${labels[m.to].full}`;
}

// "o Atlético-MG um pouco à frente" / "um jogo parelho" / "o empate bem à frente".
function leanPhrase(
  base: Triple,
  fav: OutcomeKey,
  labels: PalpiteWeighedView["labels"]
): { article: string; bare: string } {
  const order = [...OUTCOMES].sort((a, b) => base[b] - base[a]);
  const second = order[0] === fav ? order[1] : order[0];
  const slack = base[fav] - base[second];
  if (slack <= LEAN_THRESHOLDS.even)
    return { article: "um jogo parelho", bare: "jogo parelho" };
  const how =
    slack >= LEAN_THRESHOLDS.clear ? "bem à frente" : "um pouco à frente";
  return {
    article: `o ${labels[fav].full} ${how}`,
    bare: `${labels[fav].full} ${how}`,
  };
}

/** Linha da balança: de onde a conta partiu. */
export function startLine(
  basePts: Triple,
  baseOutcome: OutcomeKey,
  source: "market" | "dc_jev",
  teams: WeighedTeams
): { prefix: string; text: string } {
  return {
    prefix:
      source === "market"
        ? "Ponto de partida, os preços do jogo:"
        : "Ponto de partida, o modelo de força dos times:",
    text: leanPhrase(basePts, baseOutcome, labelsOf(teams)).bare,
  };
}

/** Resumo do bloco (PLAN-683 §4.4 + R12). */
export function summaryOf(args: {
  basePts: Triple;
  finalPts: Triple;
  baseOutcome: OutcomeKey;
  outcome: OutcomeKey;
  source: "market" | "dc_jev";
  factorPts: Triple[];
  teams: WeighedTeams;
}): PalpiteWeighedView["summary"] {
  const {
    basePts,
    finalPts,
    baseOutcome: fav,
    outcome: out,
    source,
    factorPts,
  } = args;
  const labels = labelsOf(args.teams);
  const basis = source === "market" ? "os preços" : "o modelo";
  const saw = source === "market" ? "Os preços viam" : "O modelo via";
  const sawAlready =
    source === "market" ? "Os preços já viam" : "O modelo já via";
  const lean = leanPhrase(basePts, fav, labels).article;

  if (factorPts.length === 0) {
    const t = `Nenhum ajuste mexeu: vale ${basis}`;
    return { kind: "none", icon: "same", short: [t], long: `${t}.` };
  }
  if (out !== fav) {
    const order = [...OUTCOMES].sort((a, b) => finalPts[b] - finalPts[a]);
    const second = order[0] === out ? order[1] : order[0];
    const narrow =
      finalPts[out] - finalPts[second] < NARROW_FINAL_GAP ? ", por pouco" : "";
    const turned = `Virou pro ${labels[out].full}${narrow}`;
    return {
      kind: "flip",
      icon: "flip",
      short: [turned],
      long: `${saw} ${lean}. Os ajustes viraram pro ${labels[out].full}${narrow}.`,
    };
  }
  const keeps =
    fav === "draw" ? "o palpite fica no empate" : "o palpite fica com ele";
  const head =
    fav === "draw" ? "Continua o empate:" : `Continua ${labels[fav].full}:`;
  if (factorPts.every((p) => OUTCOMES.every((k) => p[k] === 0))) {
    const t = `Os ajustes mexeram menos de 1 pt: vale ${basis}`;
    return {
      kind: "same",
      icon: "same",
      short: [t],
      long: `${sawAlready} ${lean}. ${t}.`,
    };
  }
  const delta = finalPts[fav] - basePts[fav];
  if (delta >= 3) {
    return {
      kind: "same",
      icon: "same",
      short: [head, "os ajustes reforçaram"],
      long: `${sawAlready} ${lean}. Os ajustes reforçaram e ${keeps}.`,
    };
  }
  if (delta <= -3) {
    return {
      kind: "same",
      icon: "same",
      short: [
        fav === "draw" ? "Continua o empate," : `Continua ${labels[fav].full},`,
        "com menos folga",
      ],
      long: `${sawAlready} ${lean}. Os ajustes tiraram folga, mas ${keeps}.`,
    };
  }
  // |Δ| ≤ 2: "quase se anulam" só quando houve ajuste pros dois lados; senão, mexeram pouco.
  const both =
    factorPts.some((p) => p[fav] > 0) && factorPts.some((p) => p[fav] < 0);
  return both
    ? {
        kind: "same",
        icon: "same",
        short: [head, "os ajustes quase se anulam"],
        long: `${sawAlready} ${lean}. Os ajustes quase se anulam e ${keeps}.`,
      }
    : {
        kind: "same",
        icon: "same",
        short: [head, "os ajustes mexeram pouco"],
        long: `${sawAlready} ${lean}. Os ajustes mexeram pouco e ${keeps}.`,
      };
}

/** "Também lido, sem mexer na conta" (só no diálogo). `newsCount` = notícias citadas. */
export function alsoReadLine(
  source: "market" | "dc_jev",
  newsCount: number,
  hasNewsFactor: boolean
): { label: string; text: string } {
  const where =
    source === "market" ? "já estão nos preços" : "já estão no modelo";
  let text = `forma recente, confrontos e tabela (${where})`;
  if (newsCount > 0) {
    const n =
      newsCount === 1
        ? "1 notícia do ge citada"
        : `${newsCount} notícias do ge citadas`;
    text += hasNewsFactor ? ` e ${n}` : ` e ${n} (entram só no texto)`;
  }
  return { label: "Também lido, sem mexer na conta:", text: `${text}.` };
}

// ─── Raias e barra ───────────────────────────────────────────────────────────

const INDEX: Record<OutcomeKey, number> = { home: 0, draw: 1, away: 2 };

/**
 * Pra onde foram os pontos de um fator: quem perdeu manda pra quem ganhou. Com três
 * resultados o rateio é único; a ordem de exibição é o destino mais perto de quem perdeu
 * primeiro (empate antes do outro time) e, empatando, o mandante antes (R18).
 */
export function movesOf(pts: Triple): WeighedMove[] {
  const gain = OUTCOMES.filter((k) => pts[k] > 0).map((k) => ({
    k,
    left: pts[k],
  }));
  const moves: WeighedMove[] = [];
  for (const from of OUTCOMES) {
    let left = -pts[from];
    for (const g of gain) {
      if (left <= 0) break;
      const take = Math.min(left, g.left);
      if (take > 0) {
        moves.push({ from, to: g.k, pts: take });
        g.left -= take;
        left -= take;
      }
    }
  }
  const dist = (m: WeighedMove) => Math.abs(INDEX[m.to] - INDEX[m.from]);
  return moves.sort(
    (a, b) =>
      dist(a) - dist(b) ||
      INDEX[a.to] - INDEX[b.to] ||
      INDEX[a.from] - INDEX[b.from]
  );
}

// Sequência da animação: 8 vagas (keyframes pesou-lane-0..7 e pesou-arc-0..7 no CSS).
export const MAX_SLOT = 7;
export const MAX_DOTS = 4;
const DOT_START_PX = 18;
const DOT_GAP_PX = 5.5;
const DOT_DELAY_S = 0.09;

export function laneDots(pts: number): { to: number; delay: number }[] {
  return Array.from({ length: Math.min(pts, MAX_DOTS) }, (_, i) => ({
    to: DOT_START_PX - i * DOT_GAP_PX,
    delay: Number((i * DOT_DELAY_S).toFixed(2)),
  }));
}

const cum = (t: Triple, upTo: number) =>
  OUTCOMES.slice(0, upTo).reduce((a, k) => a + t[k], 0);

/**
 * Geometria da barra em pontos (0–100) sobre a barra FINAL. Tira de saída na ponta de
 * quem perdeu, repartida por destino; tira de chegada no começo de quem ganhou; o empate
 * não ganha listra. Os fluxos são os LÍQUIDOS (base → palpite), não a soma das raias.
 * `q0` = primeira vaga da animação dos arcos (depois das raias).
 */
export function barGeometry(
  basePts: Triple,
  finalPts: Triple,
  q0: number
): Pick<PalpiteWeighedView["bar"], "hatches" | "flows" | "arcsHeight"> {
  const b = basePts;
  const p = finalPts;
  const net = movesOf({
    home: p.home - b.home,
    draw: p.draw - b.draw,
    away: p.away - b.away,
  });
  const hatches: WeighedHatch[] = [];
  const origin: Partial<Record<OutcomeKey, number>> = {};
  const landing: Partial<Record<OutcomeKey, number>> = {};
  for (const side of ["home", "away"] as const) {
    const out = net
      .filter((f) => f.from === side)
      .sort((x, y) => INDEX[x.to] - INDEX[y.to]);
    if (out.length > 0) {
      const lo = side === "home" ? p.home : cum(b, 2);
      const total = out.reduce((a, f) => a + f.pts, 0);
      let x = lo;
      for (const f of side === "home" ? out : [...out].reverse()) {
        hatches.push({
          left: x,
          width: f.pts,
          tint: f.to,
          dir: INDEX[f.to] > INDEX[f.from] ? 1 : -1,
        });
        x += f.pts;
      }
      origin[side] = lo + total / 2;
    }
    const into = net.filter((f) => f.to === side);
    if (into.length > 0) {
      const total = into.reduce((a, f) => a + f.pts, 0);
      const lo = side === "home" ? b.home : cum(p, 2);
      hatches.push({
        left: lo,
        width: total,
        tint: side,
        dir: side === "home" ? -1 : 1,
      });
      landing[side] = lo + total / 2;
    }
  }
  const drawCenter = p.home + p.draw / 2;
  origin.draw = drawCenter;
  landing.draw = drawCenter;

  const groups = OUTCOMES.map((from) => ({
    x0: origin[from]!,
    dests: net
      .filter((f) => f.from === from)
      .map((f) => ({ x: landing[f.to]!, pts: f.pts, key: f.to })),
  })).filter((g) => g.dests.length > 0);

  // Vagas dos arcos na ordem em que o desenho os percorre: por origem, lado esquerdo
  // depois direito, o destino mais perto primeiro (o de dentro do leque).
  let q = q0;
  let nested = false;
  const flows: WeighedFlowGroup[] = groups.map((g) => {
    const dests: WeighedFlowGroup["dests"] = [];
    for (const dir of [-1, 1]) {
      const side = g.dests
        .filter((t) => (t.x > g.x0 ? 1 : -1) === dir)
        .sort((a, c) => Math.abs(a.x - g.x0) - Math.abs(c.x - g.x0));
      if (side.length > 1) nested = true;
      for (const t of side) dests.push({ ...t, slot: Math.min(q++, MAX_SLOT) });
    }
    return { x0: g.x0, dests };
  });
  return {
    hatches,
    flows,
    arcsHeight: flows.length === 0 ? 0 : nested ? 32 : 22,
  };
}

// ─── Montagem ────────────────────────────────────────────────────────────────

function barSr(
  basePts: Triple,
  finalPts: Triple,
  labels: PalpiteWeighedView["labels"]
): string {
  const parts = OUTCOMES.map((k) =>
    basePts[k] === finalPts[k]
      ? `${labels[k].full} ${finalPts[k]}`
      : `${labels[k].full} de ${basePts[k]} para ${finalPts[k]}`
  );
  return `Chances do palpite, em pontos de 100: ${parts.join(", ")}.`;
}

/**
 * O bloco a partir do `headline.pick` cru (jsonb). null quando não há o que mostrar:
 * set antigo sem `weighed`, decomposição recusada (null), versão desconhecida ou conta
 * que não fecha.
 */
export function toWeighedView(
  rawPick: unknown,
  teams: WeighedTeams,
  opts: { newsCount?: number } = {}
): PalpiteWeighedView | null {
  const parsed = PickSchema.safeParse(rawPick);
  if (!parsed.success) return null;
  const { outcome, source, weighed: w } = parsed.data;
  if (!closes(w)) return null;
  const labels = labelsOf(teams);

  // Chave desconhecida (fator de uma versão futura): sem frase, a linha some, e os
  // pontos dela vão pra uma linha neutra pra conta fechar.
  const known = w.factors.filter(
    (f) => factorText(f.key, teams, "short") !== null
  );
  const unknown = w.factors.filter(
    (f) => factorText(f.key, teams, "short") === null
  );
  const entries = known.map((f) => ({
    key: f.key,
    short: factorText(f.key, teams, "short")!,
    long: factorText(f.key, teams, "long")!,
    tag:
      f.origin === "user"
        ? ("user" as const)
        : f.origin === "news"
          ? ("news" as const)
          : null,
    originLine: originLine(f.origin, f.value),
    pts: f.pts,
  }));
  if (unknown.length > 0) {
    const pts = { home: 0, draw: 0, away: 0 };
    for (const f of unknown) for (const k of OUTCOMES) pts[k] += f.pts[k];
    entries.push({
      key: "other",
      short: OTHER_ADJUSTMENT,
      long: OTHER_ADJUSTMENT,
      tag: null,
      originLine: originLine("", 0),
      pts,
    });
  }

  let slot = 0;
  const rows: WeighedRow[] = entries.map((e) => {
    const lanes = movesOf(e.pts).map((m) => ({
      ...m,
      slot: Math.min(slot++, MAX_SLOT),
      dots: laneDots(m.pts),
      sr: laneSr(m, labels),
    }));
    return {
      key: e.key,
      short: e.short,
      long: e.long,
      tag: e.tag,
      originLine: e.originLine,
      tiny: lanes.length === 0,
      lanes,
    };
  });

  const geometry = barGeometry(w.basePts, w.finalPts, slot);
  return {
    winner: outcome,
    start: startLine(w.basePts, w.baseOutcome, source, teams),
    rows,
    hasDrawLane: rows.some((r) => r.lanes.some((l) => l.to === "draw")),
    bar: {
      slices: OUTCOMES.map((k) => ({
        key: k,
        pts: w.finalPts[k],
        before: w.basePts[k] === w.finalPts[k] ? null : w.basePts[k],
        strong: k === outcome,
      })),
      ...geometry,
    },
    labels,
    summary: summaryOf({
      basePts: w.basePts,
      finalPts: w.finalPts,
      baseOutcome: w.baseOutcome,
      outcome,
      source,
      factorPts: entries.map((e) => e.pts),
      teams,
    }),
    alsoRead: alsoReadLine(
      source,
      opts.newsCount ?? 0,
      w.factors.some((f) => f.origin === "news")
    ),
    sr: barSr(w.basePts, w.finalPts, labels),
  };
}
