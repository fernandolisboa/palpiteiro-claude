"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  parseStreamLine,
  type HeroRunOutcome,
  type StepStatus,
} from "@/lib/ai/progress/protocol";
import { markRouterCacheStale } from "@/lib/nav/router-cache";

export const PALPITE_RUN_ENDPOINT = "/api/palpite/run";

export type RunStep = {
  id: string;
  status: StepStatus;
  label: string;
  // O que a etapa encontrou (ADR 0065), pro "Ver raciocínio".
  detail?: string[];
};

// Respostas em que a rota provadamente não começou o run (rota ausente num deploy
// antigo, origem recusada, corpo inválido): o HERO cai na server action de sempre.
const FALLBACK_STATUSES = new Set([400, 403, 404, 405, 415]);

const CUT_MESSAGE =
  "A conexão caiu antes do fim. A análise pode ter sido salva: confira em instantes.";
const OFFLINE_MESSAGE =
  "Não deu pra falar com o servidor. Confira a conexão e tente de novo.";
const SERVER_MESSAGE = "O servidor não respondeu agora. Tente de novo em instantes.";

export type PalpiteRun = {
  steps: RunStep[];
  // Stream em voo OU o refresh da página com o resultado ainda chegando.
  running: boolean;
  outcome: HeroRunOutcome | null;
  // "fallback" = a rota não atendeu; quem chamou usa a server action.
  start(formData: FormData): Promise<"streamed" | "fallback">;
  reset(): void;
};

/**
 * Run do HERO com progresso ao vivo (ADR 0064): POST na rota de streaming, uma linha
 * NDJSON por etapa que de fato rodou no servidor, e o resultado no fim. No fim, o
 * refresh traz o palpite novo pelas props do servidor; `running` só cai quando ele
 * chega, pra o HERO não piscar o estado antigo.
 */
export function usePalpiteRun(): PalpiteRun {
  const router = useRouter();
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [outcome, setOutcome] = useState<HeroRunOutcome | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const inFlight = useRef(false);
  // Saiu da página no meio do run: para de ler (o run segue no servidor) e não mexe
  // em estado nem dá refresh numa página que já é outra.
  const abortRef = useRef<AbortController | null>(null);
  // O run que segue sozinho grava depois: as páginas guardadas no cache do roteador
  // até aqui são relidas quando reabertas (#639). As abertas depois e antes do fim do
  // run seguem a regra dos 30s do `RevisitRefresh` (o run leva bem mais que isso).
  useEffect(
    () => () => {
      if (inFlight.current) markRouterCacheStale();
      abortRef.current?.abort();
    },
    [],
  );

  const applyStep = useCallback((step: RunStep) => {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === step.id);
      if (i === -1) return [...prev, step];
      const next = prev.slice();
      next[i] = step;
      return next;
    });
  }, []);

  const start = useCallback(
    async (formData: FormData): Promise<"streamed" | "fallback"> => {
      if (inFlight.current) return "streamed";
      inFlight.current = true;
      const abort = new AbortController();
      abortRef.current = abort;
      setSteps([]);
      setOutcome(null);
      setStreaming(true);
      let result: HeroRunOutcome | null = null;
      let refresh = false;
      try {
        let res: Response;
        try {
          res = await fetch(PALPITE_RUN_ENDPOINT, {
            method: "POST",
            body: formData,
            headers: { Accept: "application/x-ndjson" },
            signal: abort.signal,
          });
        } catch {
          result = { ok: false, error: OFFLINE_MESSAGE };
          return "streamed";
        }
        if (!res.ok || !res.body) {
          if (FALLBACK_STATUSES.has(res.status)) return "fallback";
          result = { ok: false, error: SERVER_MESSAGE };
          return "streamed";
        }
        try {
          result = await readStream(res.body, applyStep, abort.signal);
        } catch {
          result = null;
        }
        if (!result) {
          // O run segue no servidor mesmo sem o cliente: a página relê o que salvou.
          result = { ok: false, error: CUT_MESSAGE };
          refresh = true;
        } else if (result.ok) {
          refresh = true;
        } else {
          // Falha no meio pode ter gravado leituras antes: a tela fica com a mensagem,
          // e as páginas guardadas no cache são relidas quando reabertas (#639).
          markRouterCacheStale();
        }
        return "streamed";
      } finally {
        inFlight.current = false;
        if (!abort.signal.aborted) {
          if (result) setOutcome(result);
          setStreaming(false);
          if (refresh) startRefresh(() => router.refresh());
        }
      }
    },
    [applyStep, router],
  );

  const reset = useCallback(() => {
    setSteps([]);
    setOutcome(null);
  }, []);

  return {
    steps,
    running: streaming || refreshing,
    outcome,
    start,
    reset,
  };
}

// Lê o NDJSON até o resultado; null = o stream acabou sem resultado.
async function readStream(
  body: ReadableStream<Uint8Array>,
  onStep: (step: RunStep) => void,
  signal: AbortSignal,
): Promise<HeroRunOutcome | null> {
  const reader = body.getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined));
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: HeroRunOutcome | null = null;
  const consume = (line: string) => {
    const msg = parseStreamLine(line);
    if (!msg) return;
    if (msg.t === "step") {
      onStep({
        id: msg.id,
        status: msg.status,
        label: msg.label,
        ...(msg.detail ? { detail: msg.detail } : {}),
      });
    }
    else if (msg.t === "result") outcome = msg.outcome;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done || signal.aborted) break;
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
