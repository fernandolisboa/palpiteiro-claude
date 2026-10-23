import { after } from "next/server";
import { z } from "zod";

import { runPalpiteHero } from "@/app/actions/predictions";
import { auth } from "@/auth";
import {
  encodeStreamMessage,
  toHeroRunOutcome,
  type HeroRunOutcome,
  type StreamMessage,
} from "@/lib/ai/progress/protocol";
import {
  createRunMarkerWriter,
  readRunMarker,
  type RunMarkerWriter,
} from "@/lib/ai/progress/run-marker";
import { withRunProgress } from "@/lib/ai/progress/run-progress";
import { isSameOriginPost } from "@/lib/security/same-origin";

// "Analisar com IA" / "Gerar só o palpite" com progresso ao vivo (ADR 0064). Roda a
// MESMA action do form do HERO (runPalpiteHero: gates, cobrança, fan-out, síntese) e
// devolve, linha a linha, as etapas que de fato rodaram e, no fim, o resultado. A
// server action continua sendo o caminho sem JS e a reserva do cliente.
//
// Fora do middleware (/api/*): a sessão é conferida dentro da action (auth()), e a
// origem aqui, já que só server actions têm essa conferência de graça.
//
// Ciclo de vida: a resposta sai antes do run terminar. Por isso o `revalidatePath` da
// action não tem efeito aqui (o Next aplica as revalidações quando o handler devolve);
// hoje as páginas são dinâmicas e o cliente faz router.refresh() no fim. Se a pessoa
// desconectar, o Next entra na fase `after` com o run ainda em voo: cookies()/headers()
// chamados DEPOIS disso lançam. Hoje a action só os lê nos gates, antes de qualquer
// espera longa; mantenha assim.
//
// Marcador (adendo da ADR 0064): as etapas também vão pro KV, por pessoa e jogo. Quem
// sai do jogo e volta acompanha o mesmo run pela página (que lê o marcador) e pelo GET
// abaixo, até o desfecho.
export const dynamic = "force-dynamic";
// O mesmo teto da página do jogo (ACTION_BUDGET_MS = 270s conta a partir da action).
export const maxDuration = 300;

// Batida durante uma chamada longa de LLM, pra nenhum proxy fechar a conexão ociosa.
const PING_MS = 15_000;

const UNEXPECTED_ERROR = "Falha temporária ao gerar análise. Tente novamente.";

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginPost(req)) {
    return new Response(null, { status: 403 });
  }
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(null, { status: 400 });
  }

  const runId = crypto.randomUUID();
  const marker = await openMarker(formData, runId);

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const send = (msg: StreamMessage) => {
    if (msg.t === "step") marker?.step(msg);
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(encodeStreamMessage(msg)));
    } catch {
      open = false;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      send({ t: "run", id: runId });
    },
    // Cliente saiu da página: para de escrever. O run segue até o fim (after abaixo),
    // como a server action seguiria, e o resultado fica salvo pro próximo acesso.
    cancel() {
      open = false;
    },
  });

  const ping = setInterval(() => send({ t: "ping" }), PING_MS);
  const run = withRunProgress(send, () => runPalpiteHero(null, formData))
    .then(toHeroRunOutcome)
    .catch((err: unknown): HeroRunOutcome => {
      console.error(
        JSON.stringify({
          scope: "palpiteRunStream",
          error: "unexpected",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return { ok: false, error: UNEXPECTED_ERROR };
    })
    .then(async (outcome) => {
      // O marcador antes da linha final: quem acompanha pelo GET não fica pra trás de
      // quem lê o stream.
      await marker?.finish(outcome);
      send({ t: "result", outcome });
    })
    .finally(() => {
      clearInterval(ping);
      if (open && controller) {
        open = false;
        try {
          controller.close();
        } catch {
          // Já fechado pelo cliente.
        }
      }
    });
  // Segura a função viva até o run terminar, mesmo se o cliente desconectar.
  after(run);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// A sessão é lida aqui, antes de qualquer espera (depois de o cliente sair, cookies()
// lançaria). Sem sessão ou com corpo estranho, sem marcador: a action recusa o run.
async function openMarker(
  formData: FormData,
  runId: string,
): Promise<RunMarkerWriter | null> {
  const matchId = String(formData.get("matchId") ?? "");
  const intent = formData.get("intent");
  if (!z.uuid().safeParse(matchId).success) return null;
  if (intent !== "analysis" && intent !== "palpite") return null;
  let userId: string | undefined;
  try {
    userId = (await auth())?.user?.id;
  } catch {
    return null;
  }
  if (!userId) return null;
  return createRunMarkerWriter({
    userId,
    matchId,
    runId,
    intent,
    live: formData.get("pageLive") === "1",
  });
}

// O run em voo (ou recém-terminado) deste jogo, pra página que voltou acompanhar.
export async function GET(req: Request): Promise<Response> {
  const matchId = new URL(req.url).searchParams.get("matchId") ?? "";
  if (!z.uuid().safeParse(matchId).success) {
    return new Response(null, { status: 400 });
  }
  const userId = (await auth())?.user?.id;
  if (!userId) return new Response(null, { status: 401 });
  const run = await readRunMarker(userId, matchId);
  return Response.json({ run }, { headers: { "Cache-Control": "no-store" } });
}
