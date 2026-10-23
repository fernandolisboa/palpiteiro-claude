"use client";

import { startTransition, useActionState, useId, useMemo, useState } from "react";
import {
  Check,
  Info,
  Link2,
  Link2Off,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { runPalpiteHero } from "@/app/actions/predictions";
import { shareSet, unshareSet } from "@/app/actions/share";
import { SettleableBadge } from "@/components/palpites/palpite-badges";
import {
  PalpiteProgress,
  type ProgressStepView,
} from "@/components/palpites/palpite-progress";
import { usePalpiteRun } from "@/components/palpites/use-palpite-run";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { toHeroRunOutcome, type HeroRunOutcome } from "@/lib/ai/progress/protocol";
import { MAX_CONTEXT_CHARS } from "@/lib/user-palpite/types";
import { cn } from "@/lib/utils";
import {
  EMPTY_HERO_UNAVAILABLE_COPY,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";
import {
  PALPITE_DISCLAIMER,
  type PalpiteDimensionView,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";

// Rótulo qualitativo da confiança (firewall: PALAVRA, nunca dígito/%/meter/pip). O
// `aria-label` repete a palavra inteira pro leitor de tela ("confiança média").
const CONFIDENCE_LABEL: Record<PalpiteHeadlineView["confidence"], string> = {
  baixa: "confiança baixa",
  media: "confiança média",
  alta: "confiança alta",
};

type Props = {
  // null = sem palpite persistido ainda (estado empty/CTA) OU set antigo sem manchete.
  heroPalpite: PalpiteHeadlineView | null;
  matchId: string;
  // Por que o jogo não está em pré-jogo (ao vivo/adiado/cancelado/encerrado): escolhe a
  // copy do HERO sem CTA. null = pré-jogo.
  unavailable: MatchUnavailableReason | null;
  // "Analisar com IA" e "Gerar só o palpite" liberados (matchCapabilities.analyze, ADR
  // 0060): a página decide por capacidade, não por `unavailable === null`.
  analyzable: boolean;
  // Kill-switch de spend (enable_best_bet_fan_out). false → aviso suave, sem botão que erra.
  fanOutEnabled: boolean;
  // Placar real do jogo encerrado (fato do mundo, NÃO número de valor) — só pro recibo
  // de liquidação "placar provável N–M · placar real X–Y" quando o palpite está settled.
  // null = jogo não encerrado / sem gols reportados. Firewall-safe (placar ≠ odd/edge).
  finalScore: { home: number; away: number } | null;
  // #384: id do set persistido pro botão de compartilhar (gera/copia o link /p/[id]). null
  // = sem set persistido ainda (estado empty) → sem botão de share.
  setId: string | null;
  // #384: shared_at do set (null = ainda não compartilhado). Ramifica o botão: não-compartilhado
  // → "Compartilhar" (chama shareSet); já-compartilhado → "Copiar link" (copia direto).
  sharedAt: Date | null;
  // Há análises por mercado salvas → oferece "gerar só o palpite" (síntese sem re-rodar
  // o fan-out pago).
  hasAnalyses: boolean;
  // Campo "Contexto extra (opcional)" (#565): kill-switch enable_user_context ligado E
  // motor code_jev. O servidor confere de novo.
  contextEnabled: boolean;
  // Palpite compacto (#576): false = narrativa em 2 linhas (o texto inteiro fica no DOM)
  // e sem "a partir de:", ficha de dimensões e fontes, que aparecem ao abrir "Ler análise
  // completa" (PalpiteArea). Default true: os outros chamadores e testes não mudam.
  expanded?: boolean;
  // Leitura ao vivo (#594): a página foi montada com o jogo rolando e a análise liberada.
  // O form manda `pageLive=1`; sem ele, o servidor recusa um pedido ao vivo vindo de uma
  // página de pré-jogo (pede para atualizar). Default false: pré-jogo.
  live?: boolean;
  // Reconferência com a escalação mais nova que o palpite (#619): uma linha muda, só
  // texto ("Palpite gerado antes da escalação."). null/ausente = nada.
  lineupNotice?: string | null;
};

// Campo do contexto extra, controlado pelo PalpiteHero (o estado sobrevive ao
// PendingHero, que desmonta o corpo). `open` tem estado próprio: apagar o texto não
// fecha o painel no meio da edição. null = campo escondido.
type ContextField = {
  value: string;
  onChange: (v: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
} | null;

// Um form, duas ações (runPalpiteHero): o botão clicado manda `intent`. "palpite"
// refaz só a síntese sobre as análises salvas; "analysis" é o run completo.
type HeroIntent = "analysis" | "palpite";

/**
 * <PalpiteHero/> — o HERO palpite-first (ADR 0030 / #351). A manchete sintetizada é a
 * proeminência no topo da página do jogo; as análises por mercado viram detalhe neutro
 * abaixo. O dado vem do `analyzeBestBet.palpite` (já persistido, server-rendered) — o
 * botão "Analisar com IA" dispara o fan-out → síntese → revalidatePath, e o set novo
 * re-renderiza esta casca via prop (server-fed). O estado client (`useActionState`) só
 * carrega pending + os avisos: run falhou (`ok:false`) ou manchete não saiu (`palpiteError`).
 *
 * FIREWALL (ADR 0030 §3, regulatório — inviolável): este componente renderiza ZERO
 * número de valor — sem edge/EV/stake/odd/%/R$/lucro/retorno. A confiança é palavra-chip
 * (nunca meter/pip/%). O placar provável é tecido como "placar provável" em mono
 * neutro/quente-cuidadoso, NUNCA lido como odd, NUNCA verde edge-*. Os números de valor
 * são conteúdo LEGÍTIMO do detalhe recolhível neutro abaixo, nunca aqui.
 *
 * DISCLAIMER (ADR 0031 §5 / #376): a manchete agora é value-aware, então carrega um
 * rótulo regulatório ESTÁTICO (PALPITE_DISCLAIMER) — "é só um palpite, não é recomendação
 * de aposta". É invariante (não dado per-palpite), renderizado como footnote mudo no FIM
 * do PopulatedHero, deliberadamente LONGE do placar/recibo pra não ler como disclaimer de
 * liquidação. #378 deu a polish visual fina (footnote com border-top + ícone Info mudo).
 *
 * FONTES (ADR 0032 / #378): quando o palpite leu notícias reais (web search, #377), o HERO
 * lista as fontes como links clicáveis (título → URL, nova aba) entre a ficha de dimensões
 * e a CTA. FIREWALL-SAFE: {title,url} é tool output, render só texto+href, cor warm
 * (palpite-strong-fg, NUNCA edge-* verde) — esconde a seção inteira sem fontes.
 */
export function PalpiteHero({
  heroPalpite,
  matchId,
  unavailable,
  analyzable,
  fanOutEnabled,
  finalScore,
  setId,
  sharedAt,
  hasAnalyses,
  contextEnabled,
  expanded = true,
  live = false,
  lineupNotice = null,
}: Props) {
  // Dois caminhos pro mesmo run (ADR 0064): com JS, a rota de streaming mostra as etapas
  // ao vivo; sem JS (ou se a rota não atender), a server action do form, como antes.
  const [actionState, formAction, actionPending] = useActionState(runPalpiteHero, null);
  const run = usePalpiteRun();
  const [source, setSource] = useState<"stream" | "action">("stream");
  const actionOutcome = useMemo(
    () => (actionState ? toHeroRunOutcome(actionState) : null),
    [actionState],
  );
  const state: HeroRunOutcome | null =
    source === "stream" ? run.outcome : actionOutcome;
  const pending = actionPending || run.running;
  const [context, setContext] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  // Análise completa que deu certo limpa e fecha o campo: "Analisar de novo" não reenvia
  // o mesmo contexto sem querer. Ajuste no render (não em efeito) quando o resultado muda.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok && state.analysis) {
      setContext("");
      setContextOpen(false);
    }
  }
  const contextNotice = state?.ok ? (state.contextNotice ?? null) : null;
  const contextField: ContextField =
    contextEnabled && analyzable && fanOutEnabled
      ? {
          value: context,
          onChange: setContext,
          open: contextOpen,
          onOpenChange: setContextOpen,
        }
      : null;
  // Set exibido quando este form foi enviado: se outro set chegar depois (outra aba, outro
  // run), o aviso de manchete que não saiu deixa de valer.
  const [setIdAtSubmit, setSetIdAtSubmit] = useState<string | null>(null);
  const [intent, setIntent] = useState<HeroIntent>("analysis");
  // Em sucesso, o revalidate re-alimenta `heroPalpite` server-side → o componente cliente
  // ignora a view. Dois caminhos de aviso: o run falhou (ok:false) OU as análises saíram
  // mas a síntese não (ok:true + palpiteError). Sem o 2º, o HERO voltava mudo pro vazio
  // enquanto o detalhe por mercado aparecia logo abaixo.
  const error = !state
    ? null
    : state.ok
      ? setId === setIdAtSubmit
        ? (state.palpiteError ?? null)
        : null
      : state.error;

  return (
    <form
      data-tour="palpite"
      action={formAction}
      onSubmit={(e) => {
        // Com JS o envio vai pela rota de streaming; o `action` do form só atende antes
        // da hidratação (preventDefault cancela a action do React).
        e.preventDefault();
        if (pending) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        setSetIdAtSubmit(setId);
        setIntent(
          submitter?.getAttribute("value") === "palpite" ? "palpite" : "analysis",
        );
        // O botão clicado manda `intent`, como no envio nativo. Sem ele, nada de
        // intent: o servidor recusa em vez de cair no run pago.
        const formData = new FormData(e.currentTarget);
        const name = submitter?.getAttribute("name");
        if (name) formData.set(name, submitter?.getAttribute("value") ?? "");
        setSource("stream");
        void run.start(formData).then((mode) => {
          if (mode !== "fallback") return;
          setSource("action");
          startTransition(() => formAction(formData));
        });
      }}
      aria-busy={pending}
    >
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="pageLive" value={live ? "1" : "0"} />
      {/* Região viva sempre montada (o corpo desmonta no pending): o leitor de tela anuncia
          quando o texto troca. Vazia durante o envio, pra repetir o mesmo aviso. */}
      <p role="status" className="sr-only">
        {pending ? "" : (contextNotice ?? "")}
      </p>
      <HeroBody
        heroPalpite={heroPalpite}
        unavailable={unavailable}
        analyzable={analyzable}
        fanOutEnabled={fanOutEnabled}
        finalScore={finalScore}
        setId={setId}
        sharedAt={sharedAt}
        pending={pending}
        pendingIntent={intent}
        pendingSteps={source === "stream" ? run.steps : []}
        error={error}
        canRegenerate={analyzable && fanOutEnabled && hasAnalyses}
        contextField={contextField}
        contextNotice={contextNotice}
        expanded={expanded}
        live={live}
        lineupNotice={lineupNotice}
      />
    </form>
  );
}

function HeroBody({
  heroPalpite,
  unavailable,
  analyzable,
  fanOutEnabled,
  finalScore,
  setId,
  sharedAt,
  pending,
  pendingIntent,
  pendingSteps,
  error,
  canRegenerate,
  contextField,
  contextNotice,
  expanded,
  live,
  lineupNotice,
}: {
  heroPalpite: PalpiteHeadlineView | null;
  unavailable: MatchUnavailableReason | null;
  analyzable: boolean;
  fanOutEnabled: boolean;
  finalScore: { home: number; away: number } | null;
  setId: string | null;
  sharedAt: Date | null;
  pending: boolean;
  pendingIntent: HeroIntent;
  pendingSteps: ProgressStepView[];
  error: string | null;
  canRegenerate: boolean;
  contextField: ContextField;
  contextNotice: string | null;
  expanded: boolean;
  live: boolean;
  lineupNotice: string | null;
}) {
  // Pending: as etapas do run em PALAVRAS, sem dígito de tempo. Tem precedência sobre
  // tudo (o run está em voo agora).
  if (pending) {
    return <PendingHero intent={pendingIntent} live={live} steps={pendingSteps} />;
  }

  // Palpite presente (pendente OU settled): a manchete sobrevive a um erro de re-análise
  // (Callout inline acima dela). Settled ganha o badge + recibo.
  if (heroPalpite) {
    return (
      <PopulatedHero
        view={heroPalpite}
        analyzable={analyzable}
        finalScore={finalScore}
        setId={setId}
        sharedAt={sharedAt}
        error={error}
        canRegenerate={canRegenerate}
        contextField={contextField}
        contextNotice={contextNotice}
        expanded={expanded}
        lineupNotice={lineupNotice}
      />
    );
  }

  // Sem palpite: empty + CTA / kill-switch / encerrado. Erro inline quando houver.
  return (
    <EmptyHero
      unavailable={unavailable}
      analyzable={analyzable}
      fanOutEnabled={fanOutEnabled}
      error={error}
      canRegenerate={canRegenerate}
      contextField={contextField}
      contextNotice={contextNotice}
      live={live}
    />
  );
}

// Casca quente populada. Veredito carrega a tipografia; placar tecido como "placar
// provável"; confiança = palavra-chip; narrativa conversacional; citedMarkets em mono.
function PopulatedHero({
  view,
  analyzable,
  finalScore,
  setId,
  sharedAt,
  error,
  canRegenerate,
  contextField,
  contextNotice,
  expanded,
  lineupNotice,
}: {
  view: PalpiteHeadlineView;
  analyzable: boolean;
  finalScore: { home: number; away: number } | null;
  setId: string | null;
  sharedAt: Date | null;
  error: string | null;
  canRegenerate: boolean;
  contextField: ContextField;
  contextNotice: string | null;
  expanded: boolean;
  lineupNotice: string | null;
}) {
  const settled = view.badge !== null;
  return (
    <WarmShell tone="full">
      <div className="flex animate-in fade-in duration-200 flex-col gap-4 motion-reduce:animate-none">
        {error && <InlineError error={error} />}
        {contextNotice && <ContextNotice notice={contextNotice} />}

        <div className="flex flex-wrap items-center gap-2">
          <Kicker />
          {settled ? (
            <SettleableBadge state={{ kind: "settled", result: view.badge! }} />
          ) : (
            <ConfidenceChip confidence={view.confidence} />
          )}
          {view.liveLabel && <LiveMomentChip label={view.liveLabel} />}
        </div>

        {/* Veredito + placar AGRUPADOS (gap-2): leem como UMA fala do amigo
            ("Vai dar Palmeiras / provável 2–1"), o registro D-leaning que o dono
            escolheu — não veredito + stat-row separado. */}
        <div className="flex flex-col gap-2">
          <p className="max-w-reading text-balance text-display-lg font-medium leading-[1.08] tracking-tight text-foreground lg:text-display-xl">
            {view.verdict}
          </p>
          {settled ? (
            <SettledReceipt
              probableScore={view.probableScore}
              finalScore={finalScore}
            />
          ) : (
            <ProbableScore score={view.probableScore} />
          )}
        </div>

        {/* Compacto (#576): 2 linhas, com o texto inteiro no DOM (busca do navegador,
            leitor de tela); o resto do porquê abre em "Ler análise completa". */}
        <p
          className={cn(
            "max-w-reading text-body leading-relaxed tracking-tight text-muted-foreground",
            !expanded && "line-clamp-2",
          )}
        >
          {view.narrative}
        </p>

        {lineupNotice && (
          <p
            data-testid="palpite-lineup-notice"
            className="flex items-center gap-1.5 text-meta tracking-tight text-muted-foreground"
          >
            <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
            {lineupNotice}
          </p>
        )}

        {expanded && view.citedMarkets.length > 0 && (
          <p className="text-meta uppercase tracking-eyebrow text-muted-foreground">
            a partir de: {view.citedMarkets.join(" · ")}
          </p>
        )}

        {expanded && <DimensionScorecard dimensions={view.dimensions} />}

        {expanded && <CitedSources sources={view.sources} />}

        {analyzable && contextField && <UserContextField {...contextField} />}

        <div className="flex flex-wrap items-center gap-2">
          {analyzable && (
            <Button
              type="submit"
              name="intent"
              value="analysis"
              size="sm"
              variant="ghost"
              className="self-start text-palpite-strong-fg hover:bg-palpite-soft"
            >
              <Sparkles className="size-3.5" /> Analisar de novo
            </Button>
          )}
          {canRegenerate && <PalpiteOnlyButton label="Refazer só o palpite" />}
          {/* #384: compartilhar. Só com set persistido (setId). IMPERATIVO (type="button",
              onClick) — NÃO sequestra o <form action={runPalpiteHero}>. */}
          {setId !== null && <ShareButton key={setId} setId={setId} sharedAt={sharedAt} />}
        </div>

        {/* Disclaimer regulatório estático (ADR 0031 §5 / #376): ÚLTIMO filho, footnote
            mudo — deliberadamente separado do placar/recibo pra não ler como aviso de
            liquidação. #378 deu a polish: border-top quente sutil + ícone Info mudo, pra
            ler como nota de rodapé regulatória (não disclaimer de liquidação). */}
        <p className="mt-1 flex items-center gap-1.5 border-t border-palpite-border/40 pt-3 text-meta tracking-tight text-muted-foreground">
          <Info className="size-3 shrink-0" aria-hidden="true" />
          {PALPITE_DISCLAIMER}
        </p>
      </div>
    </WarmShell>
  );
}

// Botão de compartilhar (#384): IMPERATIVO (type="button", onClick) — não toca o <form
// action={runPalpiteHero}>. Ramifica em `shared` (semeado de sharedAt, depois local):
// ainda-não-compartilhado → "Compartilhar" (chama shareSet, que carimba shared_at, depois
// copia o link); já-compartilhado → "Copiar link" (copia direto SEM re-chamar o action) +
// "Parar de compartilhar" (kill-switch, ADR 0035 §3e / #438: unshareSet limpa shared_at e
// volta ao estado não-compartilhado). Confirmação "Link copiado" via useState local.
function ShareButton({
  setId,
  sharedAt,
}: {
  setId: string;
  sharedAt: Date | null;
}) {
  const [shared, setShared] = useState(sharedAt !== null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copyLink(path: string) {
    const url = window.location.origin + path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não consegui copiar o link.");
    }
  }

  async function onClick() {
    setError(null);
    if (shared) {
      // Já compartilhado: copia o link direto, sem re-chamar o action (skip-not-restamp).
      await copyLink(`/p/${setId}`);
      return;
    }
    setBusy(true);
    try {
      const r = await shareSet(setId);
      if (r.ok) {
        setShared(true);
        await copyLink(r.path);
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onUnshare() {
    setError(null);
    setBusy(true);
    try {
      const r = await unshareSet(setId);
      if (r.ok) {
        setShared(false);
        setCopied(false);
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const label = copied
    ? "Link copiado"
    : shared
      ? "Copiar link"
      : "Compartilhar";

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClick}
          disabled={busy}
          aria-live="polite"
          className="self-start text-palpite-strong-fg hover:bg-palpite-soft"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Link2 className="size-3.5" />
          )}{" "}
          {label}
        </Button>
        {shared && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onUnshare}
            disabled={busy}
            className="self-start text-muted-foreground hover:bg-palpite-soft"
          >
            <Link2Off className="size-3.5" /> Parar de compartilhar
          </Button>
        )}
      </span>
      {error && (
        <span className="text-meta tracking-tight text-muted-foreground">
          {error}
        </span>
      )}
    </span>
  );
}

// Empty: casca quente MAIS QUIETA + teaser + CTA quente (analisável+flag) | aviso suave
// (kill-switch) | aviso do motivo (ao vivo/adiado/cancelado/encerrado).
function EmptyHero({
  unavailable,
  analyzable,
  fanOutEnabled,
  error,
  canRegenerate,
  contextField,
  contextNotice,
  live,
}: {
  unavailable: MatchUnavailableReason | null;
  analyzable: boolean;
  fanOutEnabled: boolean;
  error: string | null;
  canRegenerate: boolean;
  contextField: ContextField;
  contextNotice: string | null;
  live: boolean;
}) {
  // Jogo não analisável sem palpite: predict() rejeitaria — sem CTA. O aviso ainda
  // aparece: um run iniciado antes do apito pode terminar depois dele, sem manchete.
  // Sem motivo e sem análise não acontece (o pré-jogo libera tudo): fail-closed.
  if (!analyzable) {
    return (
      <WarmShell tone="quiet">
        <div className="flex flex-col gap-2">
          {error && <InlineError error={error} />}
          <Kicker />
          <p className="text-body tracking-tight text-muted-foreground">
            {EMPTY_HERO_UNAVAILABLE_COPY[unavailable ?? "finished"]}
          </p>
        </div>
      </WarmShell>
    );
  }

  return (
    <WarmShell tone="quiet">
      <div className="flex animate-in fade-in duration-200 flex-col gap-4 motion-reduce:animate-none">
        {error && <InlineError error={error} />}
        {contextNotice && <ContextNotice notice={contextNotice} />}
        <Kicker />
        <p className="max-w-reading text-balance text-display-md font-medium leading-tight tracking-tight text-foreground">
          E aí, quem leva esse jogo?
        </p>
        {fanOutEnabled ? (
          <>
            <p className="max-w-reading text-body leading-relaxed tracking-tight text-muted-foreground">
              {live
                ? "Com o jogo rolando, a IA lê o placar e o tempo que falta e crava um palpite — como o jogo termina e o porquê."
                : "A IA lê os dois times, os números e o mercado e crava um palpite — quem ganha, o placar provável e o porquê."}
            </p>
            {contextField && <UserContextField {...contextField} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                name="intent"
                value="analysis"
                size="sm"
                className="bg-palpite-fg text-background hover:bg-palpite-strong-fg"
              >
                <Sparkles className="size-4" /> Analisar com IA
              </Button>
              {canRegenerate && <PalpiteOnlyButton label="Gerar só o palpite" />}
            </div>
            {canRegenerate && (
              <p className="max-w-reading text-body-sm tracking-tight text-muted-fg-2">
                {live
                  ? "\"Gerar só o palpite\" usa a leitura ao vivo que já está abaixo, se o placar não mudou."
                  : "\"Gerar só o palpite\" usa as análises por mercado que já estão abaixo, sem refazê-las."}
              </p>
            )}
          </>
        ) : (
          // Kill-switch (flag off): aviso suave, SEM botão (o action retornaria
          // "Recurso indisponível" antes de qualquer spend).
          <p className="text-body-sm tracking-tight text-muted-foreground">
            Palpite da IA temporariamente indisponível.
          </p>
        )}
      </div>
    </WarmShell>
  );
}

// "Contexto extra (opcional)" (#565): o que o usuário sabe e o modelo não sabe. <details>
// nativo funciona sem JS, e o textarea de um <details> fechado continua sendo postado.
// Vai junto de "Analisar com IA"/"Analisar de novo"; "só o palpite" ignora no servidor.
function UserContextField({
  value,
  onChange,
  open,
  onOpenChange,
}: NonNullable<ContextField>) {
  const id = useId();
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="group max-w-reading"
    >
      <summary className="w-fit cursor-pointer rounded-sm text-body-sm tracking-tight text-palpite-strong-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palpite-border">
        Contexto extra (opcional)
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        <label htmlFor={id} className="sr-only">
          Contexto extra
        </label>
        <textarea
          id={id}
          name="userContext"
          rows={3}
          maxLength={MAX_CONTEXT_CHARS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
          placeholder="Ex.: o mandante está sem o centroavante titular e vem de três derrotas."
          className="w-full rounded-md border border-palpite-border/60 bg-background px-3 py-2 text-body-sm tracking-tight text-foreground placeholder:text-muted-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palpite-border"
        />
        <div className="flex items-start justify-between gap-3">
          <p id={`${id}-hint`} className="text-meta leading-relaxed tracking-tight text-muted-foreground">
            A IA lê o que você escrever e a gente confere cada afirmação com os nossos dados
            antes de usar. Só entra o que passa, com peso limitado. Não conta a mais no seu
            limite do dia. Não escreva dados pessoais.
          </p>
          <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">
            {value.length}/{MAX_CONTEXT_CHARS}
          </span>
        </div>
      </div>
    </details>
  );
}

// O que aconteceu com o contexto extra no último run (#565): linha discreta, some num
// novo envio. Só visual: o leitor de tela recebe o mesmo texto pela região viva do form.
function ContextNotice({ notice }: { notice: string }) {
  return (
    <p
      aria-hidden="true"
      className="flex items-start gap-1.5 text-body-sm leading-relaxed tracking-tight text-muted-fg-2"
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {notice}
    </p>
  );
}

// Refaz só a síntese sobre as análises salvas (intent="palpite"), sem o fan-out pago.
function PalpiteOnlyButton({ label }: { label: string }) {
  return (
    <Button
      type="submit"
      name="intent"
      value="palpite"
      size="sm"
      variant="ghost"
      className="text-palpite-strong-fg hover:bg-palpite-soft"
    >
      <RefreshCw className="size-3.5" /> {label}
    </Button>
  );
}

// Run em voo (ADR 0064): as etapas que o servidor já rodou, ao vivo. Pela server action
// de reserva não há etapas: fica a linha de espera. Status em PALAVRAS, sem dígito de
// tempo. aria-busy no <form>.
const PENDING_COPY: Record<
  "palpite" | "live" | "analysis",
  { title: string; hint: string; waiting: string }
> = {
  palpite: {
    title: "Montando o palpite",
    hint: "A partir das análises salvas. Cada etapa aparece aqui assim que acontece.",
    waiting: "Montando o palpite a partir das análises…",
  },
  live: {
    title: "Lendo o jogo ao vivo",
    hint: "Cada etapa aparece aqui assim que acontece.",
    waiting: "Lendo o jogo ao vivo e montando o palpite…",
  },
  analysis: {
    title: "Analisando o jogo",
    hint: "Pode levar um minuto. Cada etapa aparece aqui assim que acontece.",
    waiting: "Começando a análise…",
  },
};

function PendingHero({
  intent,
  live,
  steps,
}: {
  intent: HeroIntent;
  live: boolean;
  steps: ProgressStepView[];
}) {
  const copy = PENDING_COPY[intent === "palpite" ? "palpite" : live ? "live" : "analysis"];
  return (
    <WarmShell tone="full">
      <div className="flex flex-col gap-4">
        <Kicker />
        <PalpiteProgress
          title={copy.title}
          hint={copy.hint}
          steps={steps}
          waitingLabel={copy.waiting}
        />
      </div>
    </WarmShell>
  );
}

// Casca quente — identidade terracota (hue 40), NUNCA loudness de casino. "full" = o
// estado com palpite/pending; "quiet" = o empty (presença mais discreta).
function WarmShell({
  tone,
  children,
}: {
  tone: "full" | "quiet";
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="palpite"
      className={cn(
        "rounded-xl border p-5 lg:p-6",
        tone === "full"
          ? "border-palpite-border bg-palpite-soft/40 ring-1 ring-palpite-border/40"
          : "border-palpite-border/60 bg-palpite-soft/30",
      )}
    >
      {children}
    </section>
  );
}

// Kicker "PALPITE DA IA" — chip mono quente, a identidade do registro.
function Kicker() {
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-palpite-soft px-2.5 py-0.5 text-meta uppercase tracking-eyebrow text-palpite-strong-fg">
      Palpite da IA
    </span>
  );
}

// Palpite gerado com o jogo rolando (#594): "palpite aos 63' (1–0)". Minuto e placar são
// FATOS do jogo (não número de valor), em mono discreto — nunca verde edge-*.
function LiveMomentChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-palpite-border/70 px-2.5 py-0.5 font-mono text-meta tabular-nums tracking-tight text-muted-foreground">
      {label}
    </span>
  );
}

// Confiança = PALAVRA-chip (firewall: sem dígito/%/meter/pip). aria-label = palavra inteira.
function ConfidenceChip({
  confidence,
}: {
  confidence: PalpiteHeadlineView["confidence"];
}) {
  const label = CONFIDENCE_LABEL[confidence];
  return (
    <span
      aria-label={label}
      className="inline-flex items-center rounded-full border border-palpite-border/70 px-2.5 py-0.5 text-meta uppercase tracking-label text-palpite-fg"
    >
      {label}
    </span>
  );
}

// Placar provável tecido como a CONTINUAÇÃO da fala (D-leaning): "provável 2–1" colado
// no veredito. Enquadramento "provável" load-bearing (firewall §9.3) — mono quente-
// cuidadoso, NUNCA verde edge-*, NUNCA lido como odd (placar 2–1 ≠ cotação 2.10).
function ProbableScore({ score }: { score: { home: number; away: number } }) {
  return (
    <p className="flex items-baseline gap-2">
      <ScoreLabel>provável</ScoreLabel>
      <ScoreDigits home={score.home} away={score.away} />
    </p>
  );
}

// Recibo de liquidação (settled): "placar provável N–M · placar real X–Y". O placar real
// é FATO do mundo (não número de valor → firewall-safe). null = jogo sem gols reportados
// → recibo cai pro provável só (o badge acertou/errou acima já carrega a honestidade).
function SettledReceipt({
  probableScore,
  finalScore,
}: {
  probableScore: { home: number; away: number };
  finalScore: { home: number; away: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <p className="flex items-baseline gap-2">
        <ScoreLabel>provável</ScoreLabel>
        <ScoreDigits home={probableScore.home} away={probableScore.away} />
      </p>
      {finalScore && (
        <p className="flex items-baseline gap-2">
          <ScoreLabel>placar real</ScoreLabel>
          <span className="font-mono text-display-sm font-medium tabular-nums tracking-tight text-foreground">
            {finalScore.home}
            <span className="px-1 text-muted-foreground">–</span>
            {finalScore.away}
          </span>
        </p>
      )}
    </div>
  );
}

// Rótulo do placar — sans minúsculo conversacional (não o eyebrow mono uppercase): casa
// com o registro de fala ("provável 2–1"), não com um stat-row de dashboard.
function ScoreLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-label tracking-tight text-muted-foreground">{children}</span>
  );
}

function ScoreDigits({ home, away }: { home: number; away: number }) {
  return (
    <span className="font-mono text-display-sm font-medium tabular-nums tracking-tight text-palpite-strong-fg">
      {home}
      <span className="px-1 text-muted-foreground">–</span>
      {away}
    </span>
  );
}

// "Ficha" QUIETA das dimensões secundárias do palpite (#354 / ADR 0030 §3, major D): o
// track-record das apostas secundárias do amigo (margem, placar do 1º tempo, quem marca
// 1º, clean sheet). Vive ESTRITAMENTE ABAIXO de veredito/placar/narrativa/citedMarkets,
// no registro CONVERSACIONAL (warm), pra ler como badges de "fala do amigo" continuada —
// NÃO um grid/stat-row de dashboard (que o ADR 0030 removeu). FIREWALL: cada label é
// placar/proposição (firewall-safe), ZERO número de valor; o badge reusa SettleableBadge
// (palavra, nunca só cor). Degrada gracioso: ESCONDE inteiro em 0 dimensões; inline
// (flex-wrap) em 1–2; nunca um card torto.
function DimensionScorecard({
  dimensions,
}: {
  dimensions: PalpiteDimensionView[];
}) {
  if (dimensions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label tracking-tight text-muted-foreground">
        e ainda
      </span>
      <ul className="flex flex-wrap gap-2">
        {dimensions.map((d, i) => (
          <li
            key={`${d.label}-${i}`}
            className="inline-flex items-center gap-2 rounded-full border border-palpite-border/60 bg-palpite-soft/40 px-3 py-1"
          >
            <span className="text-body-sm tracking-tight text-foreground">
              {d.label}
            </span>
            {/* Adapter do badge (#354 / minor H): a prop do SettleableBadge é
                {kind:"pending"|"settled"; result?}, NÃO "won"|"lost"|null. */}
            <SettleableBadge
              state={
                d.badge === null
                  ? { kind: "pending" }
                  : { kind: "settled", result: d.badge }
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Fontes de notícia citadas (ADR 0032 / #378): os links reais que o palpite LEU (web
// search, #377) — título → URL (nova aba). Vive ENTRE a ficha de dimensões e a CTA, no
// mesmo registro conversacional quieto (label-then-list, igual ao DimensionScorecard).
// FIREWALL: {title,url} é TOOL OUTPUT (nunca prosa do LLM), render só texto do título +
// href — cor warm `text-palpite-strong-fg` (a identidade do palpite), NUNCA edge-* verde,
// ZERO dígito/%/meter/token de valor. Degrada gracioso: ESCONDE inteiro sem fontes (sets
// pré-#377 ou jogo sem notícia). Responsivo: empilha no mobile (flex-col) → inline com `·`
// no desktop (sm:flex-row sm:flex-wrap; o separador é hidden sm:inline).
function CitedSources({
  sources,
}: {
  sources?: Array<{ title: string; url: string }>;
}) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label tracking-tight text-muted-foreground">
        o palpite leu
      </span>
      <ul className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
        {sources.map((s, i) => (
          <li key={`${s.url}-${i}`} className="flex items-baseline gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="hidden text-muted-fg-2 sm:inline">
                ·
              </span>
            )}
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-body-sm tracking-tight text-palpite-strong-fg underline decoration-palpite-border underline-offset-2 hover:decoration-palpite-strong-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palpite-border"
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Erro inline (re-análise falhou OU recurso indisponível em runtime). Callout warn
// retryable — o botão do <form> re-submete; a manchete anterior (se houver) sobrevive acima.
function InlineError({ error }: { error: string }) {
  return (
    <Callout
      variant="warn"
      icon={<TriangleAlert className="size-4" />}
      title="Não rolou dessa vez"
    >
      <span className="text-body-sm leading-relaxed tracking-tight text-muted-foreground">
        {error}
      </span>
    </Callout>
  );
}
