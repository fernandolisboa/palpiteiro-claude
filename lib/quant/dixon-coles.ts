// Dixon-Coles MLE (Report 03 rec. 6, ADR 0039 D2, #502). Módulo PURO como o resto de
// `lib/quant` — ZERO imports de db/ai/providers; o input é estrutural.
//
// Modelo (Dixon & Coles 1997): gols do mandante ~ Poisson(λ = γ·α_casa·β_fora),
// gols do visitante ~ Poisson(μ = α_fora·β_casa), com a correção τ(ρ) nos placares
// baixos e peso exponencial por recência w = exp(−ξ·dias). α = ataque, β = defesa
// (maior = sofre mais), γ = vantagem de mando.
//
// Ajuste em DUAS etapas (aproximação padrão, documentada no ADR):
//  1. (α, β, γ) por máxima verossimilhança do Poisson independente ponderado, via o
//     ponto fixo de Maher (atualizações fechadas, converge monotonicamente). Um prior
//     de pseudo-contagem puxa times com pouco histórico pra média (α=β=1) — sem ele,
//     um promovido com 2 jogos vira ±∞.
//  2. ρ por busca de seção áurea na log-verossimilhança de τ com (α, β, γ) fixos.
// A etapa 2 move pouco os λ (τ só toca 0-0/1-0/0-1/1-1), então a separação custa
// quase nada frente ao MLE conjunto e deixa o ajuste determinístico e sem otimizador.

export type DcMatch = {
  date: Date;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
};

export type DixonColesModel = {
  attack: ReadonlyMap<string, number>;
  defence: ReadonlyMap<string, number>;
  homeAdvantage: number; // γ
  rho: number;
  asOf: Date;
};

export type DixonColesOptions = {
  xiPerDay?: number; // decaimento; 0.0019 ≈ meia-vida de 1 ano (Dixon-Coles 1997)
  maxAgeDays?: number; // janela dura (peso < e^-ξ·idade já é desprezível)
  priorGoals?: number; // pseudo-contagem do prior de cada α/β, em gols esperados
  iterations?: number;
};

export const DC_DEFAULTS: Required<DixonColesOptions> = {
  xiPerDay: 0.0019,
  maxAgeDays: 3 * 365,
  priorGoals: 2,
  iterations: 60,
};

const DAY_MS = 86_400_000;
const RHO_MIN = -0.25;
const RHO_MAX = 0.25;

function tau(h: number, a: number, lh: number, la: number, rho: number) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/**
 * Ajusta o DC com os jogos ESTRITAMENTE anteriores a `asOf` (o caller garante o
 * point-in-time; aqui filtramos de novo por segurança). null sem jogos na janela.
 */
export function fitDixonColes(
  matches: readonly DcMatch[],
  asOf: Date,
  options: DixonColesOptions = {},
): DixonColesModel | null {
  const o = { ...DC_DEFAULTS, ...options };
  const t0 = asOf.getTime();
  const data = matches
    .filter((m) => {
      const age = (t0 - m.date.getTime()) / DAY_MS;
      return age > 0 && age <= o.maxAgeDays;
    })
    .map((m) => ({
      ...m,
      w: Math.exp(-o.xiPerDay * ((t0 - m.date.getTime()) / DAY_MS)),
    }));
  if (data.length === 0) return null;

  const teams = [...new Set(data.flatMap((m) => [m.home, m.away]))];
  const attack = new Map(teams.map((t) => [t, 1]));
  const defence = new Map(teams.map((t) => [t, 1]));
  let gamma = 1;
  const k = o.priorGoals;

  for (let it = 0; it < o.iterations; it++) {
    // α_i = (gols marcados ponderados + k) / (gols esperados sem α_i + k)
    const aNum = new Map(teams.map((t) => [t, k]));
    const aDen = new Map(teams.map((t) => [t, k]));
    for (const m of data) {
      aNum.set(m.home, aNum.get(m.home)! + m.w * m.homeGoals);
      aDen.set(m.home, aDen.get(m.home)! + m.w * gamma * defence.get(m.away)!);
      aNum.set(m.away, aNum.get(m.away)! + m.w * m.awayGoals);
      aDen.set(m.away, aDen.get(m.away)! + m.w * defence.get(m.home)!);
    }
    for (const t of teams) attack.set(t, aNum.get(t)! / aDen.get(t)!);

    const dNum = new Map(teams.map((t) => [t, k]));
    const dDen = new Map(teams.map((t) => [t, k]));
    for (const m of data) {
      dNum.set(m.away, dNum.get(m.away)! + m.w * m.homeGoals);
      dDen.set(m.away, dDen.get(m.away)! + m.w * gamma * attack.get(m.home)!);
      dNum.set(m.home, dNum.get(m.home)! + m.w * m.awayGoals);
      dDen.set(m.home, dDen.get(m.home)! + m.w * attack.get(m.away)!);
    }
    for (const t of teams) defence.set(t, dNum.get(t)! / dDen.get(t)!);

    // Identificabilidade: média geométrica de α = 1 (a escala vai pra β).
    const logMean =
      teams.reduce((s, t) => s + Math.log(attack.get(t)!), 0) / teams.length;
    const scale = Math.exp(logMean);
    for (const t of teams) {
      attack.set(t, attack.get(t)! / scale);
      defence.set(t, defence.get(t)! * scale);
    }

    let gNum = 0;
    let gDen = 0;
    for (const m of data) {
      gNum += m.w * m.homeGoals;
      gDen += m.w * attack.get(m.home)! * defence.get(m.away)!;
    }
    gamma = gDen > 0 ? gNum / gDen : 1;
  }

  // ρ: seção áurea na log-verossimilhança ponderada de τ (só os placares baixos
  // contribuem; os demais têm τ=1 e somam 0).
  const low = data
    .filter((m) => m.homeGoals <= 1 && m.awayGoals <= 1)
    .map((m) => ({
      ...m,
      lh: gamma * attack.get(m.home)! * defence.get(m.away)!,
      la: attack.get(m.away)! * defence.get(m.home)!,
    }));
  const ll = (rho: number) =>
    low.reduce((s, m) => {
      const t = tau(m.homeGoals, m.awayGoals, m.lh, m.la, rho);
      return s + m.w * (t > 0 ? Math.log(t) : -1e6);
    }, 0);
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = RHO_MIN;
  let hi = RHO_MAX;
  for (let i = 0; i < 60; i++) {
    const x1 = hi - phi * (hi - lo);
    const x2 = lo + phi * (hi - lo);
    if (ll(x1) < ll(x2)) lo = x1;
    else hi = x2;
  }

  return {
    attack,
    defence,
    homeAdvantage: gamma,
    rho: (lo + hi) / 2,
    asOf,
  };
}

/**
 * λ do jogo pelo modelo ajustado. null se algum time não tem histórico na janela
 * (promovido sem jogos) — o caller cai no heurístico (escada do ADR 0039 D2).
 */
export function dixonColesLambdas(
  model: DixonColesModel,
  home: string,
  away: string,
): { lambdaHome: number; lambdaAway: number } | null {
  const ah = model.attack.get(home);
  const dh = model.defence.get(home);
  const aa = model.attack.get(away);
  const da = model.defence.get(away);
  if (
    ah === undefined ||
    dh === undefined ||
    aa === undefined ||
    da === undefined
  ) {
    return null;
  }
  return {
    lambdaHome: model.homeAdvantage * ah * da,
    lambdaAway: aa * dh,
  };
}
