// Runs do HERO por jogo, fora do componente (adendo da ADR 0064). O run segue no
// servidor quando a pessoa sai do jogo; aqui ele também segue no navegador: a leitura
// do stream não morre com a página, e quem volta pro jogo encontra as etapas de agora
// (ou o desfecho, se terminou enquanto estava fora). Um registro por jogo: dois jogos
// analisando ao mesmo tempo nunca trocam etapas nem resultado.
//
// Sem a conexão que começou o run (F5, outra aba, stream que caiu), o registro segue o
// marcador do servidor pelo GET da rota, até o desfecho.
//
// Estado de módulo só no navegador: no servidor (SSR do componente) nada aqui é
// chamado fora do `getRun`, que lê o mapa vazio.

import {
  parseRunSnapshot,
  parseStreamLine,
  type HeroRunOutcome,
  type RunIntent,
  type RunSnapshot,
  type RunStepSnapshot,
} from "@/lib/ai/progress/protocol";
import { markRouterCacheStale } from "@/lib/nav/router-cache";

export const PALPITE_RUN_ENDPOINT = "/api/palpite/run";

export type RunStep = RunStepSnapshot;

export type RunEntry = {
  runId: string | null;
  intent: RunIntent;
  live: boolean;
  // Set exibido quando o run começou: outro set depois disso = o run deu palpite novo
  // (ou outra aba deu), e o aviso de manchete que não saiu deixa de valer.
  baseSetId: string | null;
  steps: RunStep[];
  status: "running" | "finished";
  outcome: HeroRunOutcome | null;
  // O fim gravou algo (ou pode ter gravado): a página relê o servidor.
  refresh: boolean;
};

export type RunMeta = Pick<RunEntry, "intent" | "live" | "baseSetId">;

// Respostas em que a rota provadamente não começou o run (rota ausente num deploy
// antigo, origem recusada, corpo inválido): o HERO cai na server action de sempre.
const FALLBACK_STATUSES = new Set([400, 403, 404, 405, 415]);

export const CUT_MESSAGE =
  "A conexão caiu antes do fim. A análise pode ter sido salva: confira em instantes.";
const OFFLINE_MESSAGE =
  "Não deu pra falar com o servidor. Confira a conexão e tente de novo.";
const SERVER_MESSAGE = "O servidor não respondeu agora. Tente de novo em instantes.";

const POLL_MS = 2_000;
// Stream que caiu logo no começo: o marcador pode ainda não ter sido gravado. Tenta mais
// algumas vezes antes de dar o aviso de conexão caída.
const CUT_MISS_RETRIES = 2;
let pollMs = POLL_MS;
// Falha de rede seguida no acompanhamento: desiste depois disso (o run já teria
// passado do teto da rota).
const POLL_GIVE_UP_MS = 6 * 60_000;

// Um registro por jogo. Cada run tem a própria vaga: um stream ou acompanhamento de
// um run que já saiu do mapa (substituído, entregue) não mexe no registro de outro.
type Slot = { matchId: string; entry: RunEntry; following: boolean };

const slots = new Map<string, Slot>();
const listeners = new Map<string, Set<() => void>>();
// Runs já entregues a um HERO: uma página antiga do cache que ainda diga "em voo" não
// volta a acompanhar um run que terminou.
const consumed = new Set<string>();

export function getRun(matchId: string): RunEntry | null {
  return slots.get(matchId)?.entry ?? null;
}

export function isRunConsumed(runId: string): boolean {
  return consumed.has(runId);
}

export function subscribeRun(matchId: string, listener: () => void): () => void {
  let set = listeners.get(matchId);
  if (!set) {
    set = new Set();
    listeners.set(matchId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(matchId);
  };
}

function watched(matchId: string): boolean {
  return (listeners.get(matchId)?.size ?? 0) > 0;
}

function emit(matchId: string) {
  for (const l of listeners.get(matchId) ?? []) l();
}

function current(slot: Slot): boolean {
  return slots.get(slot.matchId) === slot;
}

function open(matchId: string, entry: RunEntry): Slot {
  const slot: Slot = { matchId, entry, following: false };
  slots.set(matchId, slot);
  emit(matchId);
  return slot;
}

function drop(slot: Slot) {
  if (!current(slot)) return;
  slots.delete(slot.matchId);
  emit(slot.matchId);
}

function update(slot: Slot, patch: Partial<RunEntry>) {
  if (!current(slot)) return;
  slot.entry = { ...slot.entry, ...patch };
  emit(slot.matchId);
}

function applyStep(slot: Slot, step: RunStep) {
  const i = slot.entry.steps.findIndex((s) => s.id === step.id);
  const steps = slot.entry.steps.slice();
  if (i === -1) steps.push(step);
  else steps[i] = step;
  update(slot, { steps });
}

function finish(slot: Slot, outcome: HeroRunOutcome | null, refresh: boolean) {
  if (!current(slot)) return;
  update(slot, { status: "finished", outcome, refresh });
  // Ninguém olhando este jogo agora: as páginas guardadas no cache do roteador (#639)
  // são relidas quando reabertas, e o HERO entrega o desfecho quando o jogo voltar.
  if (!watched(slot.matchId) && refresh) markRouterCacheStale();
}

/**
 * O HERO que montou (ou já estava montado) entrega o desfecho: tira o registro e
 * devolve o que ele tinha. null = nada terminado pra este jogo.
 */
export function consumeRun(matchId: string): RunEntry | null {
  const slot = slots.get(matchId);
  if (!slot || slot.entry.status !== "finished") return null;
  if (slot.entry.runId) consumed.add(slot.entry.runId);
  drop(slot);
  return slot.entry;
}

/**
 * Começa um run pela rota de streaming. "fallback" = a rota não atendeu e quem chamou
 * usa a server action. Com um run deste jogo já em voo, não começa outro.
 */
export async function startRun(
  matchId: string,
  formData: FormData,
  meta: RunMeta,
): Promise<"streamed" | "fallback"> {
  if (slots.get(matchId)?.entry.status === "running") return "streamed";
  const slot = open(matchId, {
    ...meta,
    runId: null,
    steps: [],
    status: "running",
    outcome: null,
    refresh: false,
  });

  let res: Response;
  try {
    res = await fetch(PALPITE_RUN_ENDPOINT, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/x-ndjson" },
    });
  } catch {
    finish(slot, { ok: false, error: OFFLINE_MESSAGE }, false);
    return "streamed";
  }
  if (!res.ok || !res.body) {
    if (FALLBACK_STATUSES.has(res.status)) {
      drop(slot);
      return "fallback";
    }
    finish(slot, { ok: false, error: SERVER_MESSAGE }, false);
    return "streamed";
  }

  let outcome: HeroRunOutcome | null = null;
  try {
    outcome = await readStream(res.body, slot);
  } catch {
    outcome = null;
  }
  if (!outcome) {
    // O stream caiu sem resultado: o run segue no servidor. Acompanha pelo marcador.
    void follow(slot, { cut: true });
  } else if (outcome.ok) {
    finish(slot, outcome, true);
  } else {
    // Falha no meio pode ter gravado leituras antes: a tela fica com a mensagem, e as
    // páginas guardadas no cache são relidas quando reabertas (#639).
    markRouterCacheStale();
    finish(slot, outcome, false);
  }
  return "streamed";
}

/**
 * A página veio com um run em voo do servidor (saiu do jogo no meio, F5, outra aba).
 * Sem registro deste jogo no navegador, passa a acompanhar o marcador.
 */
export function resumeRun(
  matchId: string,
  snapshot: RunSnapshot,
  baseSetId: string | null,
): void {
  if (slots.has(matchId) || consumed.has(snapshot.runId)) return;
  const slot = open(matchId, {
    runId: snapshot.runId,
    intent: snapshot.intent,
    live: snapshot.live,
    baseSetId,
    steps: snapshot.steps,
    status: "running",
    outcome: null,
    refresh: false,
  });
  void follow(slot, { cut: false });
}

/**
 * Acompanha o marcador do servidor enquanto alguém olha o jogo. Sem ninguém olhando,
 * para e solta o registro: quem voltar recebe o marcador de novo pela página.
 */
async function follow(slot: Slot, { cut }: { cut: boolean }) {
  if (slot.following) return;
  slot.following = true;
  const startedAt = Date.now();
  let first = cut;
  let misses = 0;
  const giveUp = () =>
    finish(slot, cut ? { ok: false, error: CUT_MESSAGE } : null, true);
  for (;;) {
    if (!first) await sleep(pollMs);
    first = false;
    if (!current(slot) || slot.entry.status !== "running") return;
    if (!watched(slot.matchId)) {
      drop(slot);
      markRouterCacheStale();
      return;
    }
    let snapshot: RunSnapshot | null;
    try {
      const res = await fetch(
        `${PALPITE_RUN_ENDPOINT}?matchId=${encodeURIComponent(slot.matchId)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      snapshot = res.ok ? await readSnapshot(res) : null;
    } catch {
      // Sem rede agora: tenta de novo até o run já ter passado do teto da rota.
      if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
        giveUp();
        return;
      }
      continue;
    }
    // Stream que caiu: só vale o marcador deste run. Sem ele (ainda não gravou, ou KV
    // fora), o mesmo aviso de antes. Na volta à página, um run mais novo (outra aba)
    // passa a ser o acompanhado.
    if (snapshot && cut && slot.entry.runId && snapshot.runId !== slot.entry.runId) {
      snapshot = null;
    }
    if (!snapshot) {
      if (cut && misses < CUT_MISS_RETRIES) {
        misses += 1;
        continue;
      }
      giveUp();
      return;
    }
    update(slot, { runId: snapshot.runId, steps: snapshot.steps });
    if (snapshot.status === "done") {
      finish(slot, snapshot.outcome, true);
      return;
    }
  }
}

async function readSnapshot(res: Response): Promise<RunSnapshot | null> {
  try {
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    return parseRunSnapshot((body as { run?: unknown }).run);
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Lê o NDJSON até o resultado; null = o stream acabou sem resultado.
async function readStream(
  body: ReadableStream<Uint8Array>,
  slot: Slot,
): Promise<HeroRunOutcome | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: HeroRunOutcome | null = null;
  const consume = (line: string) => {
    const msg = parseStreamLine(line);
    if (!msg) return;
    if (msg.t === "run") update(slot, { runId: msg.id });
    else if (msg.t === "step") {
      applyStep(slot, {
        id: msg.id,
        status: msg.status,
        label: msg.label,
        ...(msg.detail ? { detail: msg.detail } : {}),
      });
    } else if (msg.t === "result") outcome = msg.outcome;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      consume(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) consume(buffer);
  return outcome;
}

// Testes: cada caso começa sem runs de outro (e com a espera entre leituras que pedir).
export function resetRunStoreForTests(opts?: { pollMs?: number }): void {
  pollMs = opts?.pollMs ?? POLL_MS;
  slots.clear();
  listeners.clear();
  consumed.clear();
}
