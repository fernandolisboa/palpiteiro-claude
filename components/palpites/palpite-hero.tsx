"use client";

import { useActionState } from "react";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";

import { analyzeBestBet } from "@/app/actions/predictions";
import { SettleableBadge } from "@/components/palpites/palpite-badges";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";
import type {
  PalpiteDimensionView,
  PalpiteHeadlineView,
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
  // false em jogos encerrados/cancelados (predict() os rejeita) → sem CTA.
  analyzable: boolean;
  // Kill-switch de spend (enable_best_bet_fan_out). false → aviso suave, sem botão que erra.
  fanOutEnabled: boolean;
  // Placar real do jogo encerrado (fato do mundo, NÃO número de valor) — só pro recibo
  // de liquidação "placar provável N–M · placar real X–Y" quando o palpite está settled.
  // null = jogo não encerrado / sem gols reportados. Firewall-safe (placar ≠ odd/edge).
  finalScore: { home: number; away: number } | null;
};

/**
 * <PalpiteHero/> — o HERO palpite-first (ADR 0030 / #351). A manchete sintetizada é a
 * proeminência no topo da página do jogo; as análises por mercado viram detalhe neutro
 * abaixo. O dado vem do `analyzeBestBet.palpite` (já persistido, server-rendered) — o
 * botão "Analisar com IA" dispara o fan-out → síntese → revalidatePath, e o set novo
 * re-renderiza esta casca via prop (server-fed). O estado client (`useActionState`) só
 * carrega pending + o caminho de erro (`state.ok === false`).
 *
 * FIREWALL (ADR 0030 §3, regulatório — inviolável): este componente renderiza ZERO
 * número de valor — sem edge/EV/stake/odd/%/R$/lucro/retorno. A confiança é palavra-chip
 * (nunca meter/pip/%). O placar provável é tecido como "placar provável" em mono
 * neutro/quente-cuidadoso, NUNCA lido como odd, NUNCA verde edge-*. Os números de valor
 * são conteúdo LEGÍTIMO do detalhe recolhível neutro abaixo, nunca aqui.
 */
export function PalpiteHero({
  heroPalpite,
  matchId,
  analyzable,
  fanOutEnabled,
  finalScore,
}: Props) {
  const [state, formAction, pending] = useActionState(analyzeBestBet, null);
  // Erro só importa quando o action falhou neste render (state.ok === false). Em sucesso,
  // o revalidate re-alimenta `heroPalpite` server-side → o componente cliente ignora a view.
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />
      <HeroBody
        heroPalpite={heroPalpite}
        analyzable={analyzable}
        fanOutEnabled={fanOutEnabled}
        finalScore={finalScore}
        pending={pending}
        error={error}
      />
    </form>
  );
}

function HeroBody({
  heroPalpite,
  analyzable,
  fanOutEnabled,
  finalScore,
  pending,
  error,
}: {
  heroPalpite: PalpiteHeadlineView | null;
  analyzable: boolean;
  fanOutEnabled: boolean;
  finalScore: { home: number; away: number } | null;
  pending: boolean;
  error: string | null;
}) {
  // Pending: skeleton que espelha o populated (sem reflow) — status em PALAVRAS, sem
  // dígito de tempo. Tem precedência sobre tudo (o run está em voo agora).
  if (pending) return <PendingHero />;

  // Palpite presente (pendente OU settled): a manchete sobrevive a um erro de re-análise
  // (Callout inline acima dela). Settled ganha o badge + recibo.
  if (heroPalpite) {
    return (
      <PopulatedHero
        view={heroPalpite}
        analyzable={analyzable}
        finalScore={finalScore}
        error={error}
      />
    );
  }

  // Sem palpite: empty + CTA / kill-switch / encerrado. Erro inline quando houver.
  return (
    <EmptyHero
      analyzable={analyzable}
      fanOutEnabled={fanOutEnabled}
      error={error}
    />
  );
}

// Casca quente populada. Veredito carrega a tipografia; placar tecido como "placar
// provável"; confiança = palavra-chip; narrativa conversacional; citedMarkets em mono.
function PopulatedHero({
  view,
  analyzable,
  finalScore,
  error,
}: {
  view: PalpiteHeadlineView;
  analyzable: boolean;
  finalScore: { home: number; away: number } | null;
  error: string | null;
}) {
  const settled = view.badge !== null;
  return (
    <WarmShell tone="full">
      <div className="flex animate-in fade-in duration-200 flex-col gap-4 motion-reduce:animate-none">
        {error && <InlineError error={error} />}

        <div className="flex flex-wrap items-center gap-2">
          <Kicker />
          {settled ? (
            <SettleableBadge state={{ kind: "settled", result: view.badge! }} />
          ) : (
            <ConfidenceChip confidence={view.confidence} />
          )}
        </div>

        {/* Veredito + placar AGRUPADOS (gap-2): leem como UMA fala do amigo
            ("Vai dar Palmeiras / provável 2–1"), o registro D-leaning que o dono
            escolheu — não veredito + stat-row separado. */}
        <div className="flex flex-col gap-2">
          <p className="max-w-reading text-balance text-display-lg font-medium leading-[1.08] tracking-tight text-foreground lg:text-[40px]">
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

        <p className="max-w-reading text-body leading-relaxed tracking-tight text-muted-foreground">
          {view.narrative}
        </p>

        {view.citedMarkets.length > 0 && (
          <p className="font-mono text-eyebrow-xs uppercase tracking-eyebrow text-muted-fg-2">
            a partir de: {view.citedMarkets.join(" · ")}
          </p>
        )}

        <DimensionScorecard dimensions={view.dimensions} />

        {analyzable && (
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="self-start text-palpite-strong-fg hover:bg-palpite-soft"
          >
            <Sparkles className="size-3.5" /> Analisar de novo
          </Button>
        )}
      </div>
    </WarmShell>
  );
}

// Empty: casca quente MAIS QUIETA + teaser + CTA quente (analyzable+flag) | aviso suave
// (kill-switch) | aviso encerrado.
function EmptyHero({
  analyzable,
  fanOutEnabled,
  error,
}: {
  analyzable: boolean;
  fanOutEnabled: boolean;
  error: string | null;
}) {
  // Jogo encerrado/cancelado sem palpite: predict() rejeitaria — sem CTA.
  if (!analyzable) {
    return (
      <WarmShell tone="quiet">
        <div className="flex flex-col gap-2">
          <Kicker />
          <p className="text-body tracking-tight text-muted-foreground">
            Jogo encerrado, sem palpite por aqui.
          </p>
        </div>
      </WarmShell>
    );
  }

  return (
    <WarmShell tone="quiet">
      <div className="flex animate-in fade-in duration-200 flex-col gap-4 motion-reduce:animate-none">
        {error && <InlineError error={error} />}
        <Kicker />
        <p className="max-w-reading text-balance text-display-md font-medium leading-tight tracking-tight text-foreground">
          E aí, quem leva esse jogo?
        </p>
        {fanOutEnabled ? (
          <>
            <p className="max-w-reading text-body leading-relaxed tracking-tight text-muted-foreground">
              A IA lê os dois times, os números e o mercado e crava um palpite —
              quem ganha, o placar provável e o porquê.
            </p>
            <Button
              type="submit"
              size="sm"
              className="self-start bg-palpite-fg text-background hover:bg-palpite-strong-fg"
            >
              <Sparkles className="size-4" /> Analisar com IA
            </Button>
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

// Skeleton que espelha o populated (mesma casca quente, mesmos blocos) — sem reflow ao
// trocar pelo conteúdo. Status em PALAVRAS, sem dígito de tempo. aria-busy no <form>.
function PendingHero() {
  return (
    <WarmShell tone="full">
      <div className="flex flex-col gap-4">
        <Kicker />
        <div className="flex flex-col gap-2.5">
          <div className="h-8 w-3/4 rounded-md bg-palpite-soft" />
          <div className="h-8 w-1/2 rounded-md bg-palpite-soft" />
        </div>
        <div className="h-4 w-40 rounded-md bg-palpite-soft" />
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-full rounded-md bg-palpite-soft/70" />
          <div className="h-3 w-5/6 rounded-md bg-palpite-soft/70" />
        </div>
        <div className="flex items-center gap-2 text-body-sm tracking-tight text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          <span>lendo os mercados e montando o palpite… (pode levar um minuto)</span>
        </div>
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

// Kicker "O PALPITE" — chip mono quente, a identidade do registro.
function Kicker() {
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-palpite-soft px-2.5 py-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-palpite-strong-fg">
      O Palpite
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
      className="inline-flex items-center rounded-full border border-palpite-border/70 px-2.5 py-0.5 font-mono text-eyebrow uppercase tracking-label text-palpite-fg"
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
