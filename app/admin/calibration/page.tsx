import Link from "next/link";

import { PageHeading } from "@/components/admin/page-heading";
import { EmptyState } from "@/components/empty-state";
import {
  ANALYSIS_ENGINES,
  ANALYSIS_ENGINE_LABEL,
} from "@/lib/ai/engine/analysis-engine";
import {
  deriveCalibration,
  deriveCalibrationByEngine,
  filterByEngineSegment,
  parseEngineSegment,
  type CalibrationGroup,
  type EngineCalibration,
  type EngineSegment,
} from "@/lib/calibration/derive";
import type { ReliabilityBin } from "@/lib/calibration/metrics";
import { loadKellyGate } from "@/lib/calibration/kelly-live";
import type { KellyGate } from "@/lib/calibration/phase-c-gate";
import { getOverUnderCalibrationRows } from "@/lib/db/queries/calibration";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
// Harness de calibração (Report 03 rec. 3, ADR 0037): mede o P(over) do modelo (LLM
// ancorado no Poisson, tracer #482) contra os resultados liquidados, com o mercado
// no-vig de benchmark. Substituto vivo dos backtests desescopados — enche com o D9.
// Segmentado por motor (ADR 0041 §5/§7, #513): `?engine=llm|code_jev` recorta o
// resumo/versões/bins; a tabela "por motor" compara os dois lado a lado. O gate do
// Kelly NÃO é recortado — é o mesmo número que o predict lê pra decidir o staking.

const BACKTEST_REPORT_URL =
  "https://github.com/fernandolisboa/palpiteiro-claude/blob/main/docs/reports/10-backtest-dixon-coles.md";

const fmt3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");
const fmtSkill = (n: number) =>
  Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(3)}` : "—";
const fmtPct = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(0)}%`;

type PageProps = {
  searchParams: Promise<{ engine?: string | string[] }>;
};

export default async function AdminCalibrationPage({ searchParams }: PageProps) {
  const segment = parseEngineSegment((await searchParams).engine);
  const [rows, gate] = await Promise.all([
    getOverUnderCalibrationRows(),
    loadKellyGate(),
  ]);
  const byEngine = deriveCalibrationByEngine(rows);
  const scoped = filterByEngineSegment(rows, segment);
  const { overall, byVersion } = deriveCalibration(scoped);
  const betCount = scoped.filter((r) => r.isBet).length;
  const segmentLabel =
    segment === "all" ? "todos os motores" : ANALYSIS_ENGINE_LABEL[segment];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Calibração"
          subtitle="over/under · P(over) do modelo vs resultados · benchmark = mercado no-vig"
        />

        <GateSection gate={gate} />

        <BacktestSection />

        {rows.length > 0 && (
          <EngineSection
            engines={byEngine.engines}
            unattributed={byEngine.unattributed}
            segment={segment}
          />
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="Sem predições over/under liquidadas ainda"
            description="O harness enche conforme as análises de over/under são liquidadas (com P(over) do modelo persistido). Volte depois de alguns jogos."
          />
        ) : overall === null ? (
          <EmptyState
            title={`Sem predições liquidadas do motor ${segmentLabel} ainda`}
            description="O recorte enche conforme as análises de over/under desse motor são liquidadas. Os outros motores seguem na tabela acima."
          />
        ) : (
          <>
            {/* Resumo agregado (do recorte) */}
            <section className="pb-8">
              <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                resumo · {segmentLabel} · {overall.n} predições · {betCount}{" "}
                apostas · {overall.n - betCount} passes
              </h2>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
                <Kpi label="log-loss modelo" value={fmt3(overall.model.logLoss)} />
                <Kpi
                  label="log-loss mercado"
                  value={fmt3(overall.market.logLoss)}
                />
                <Kpi label="brier modelo" value={fmt3(overall.model.brier)} />
                <Kpi label="brier mercado" value={fmt3(overall.market.brier)} />
                <Kpi
                  label="slope modelo"
                  value={fmt3(overall.model.slope)}
                  hint="1 = calibrado · <1 = overconfident"
                />
                <Kpi
                  label="skill (log-loss)"
                  value={fmtSkill(overall.logLossSkill)}
                  hint={
                    overall.logLossSkill >= 0
                      ? "modelo bate o mercado"
                      : "mercado bate o modelo"
                  }
                />
              </div>
            </section>

            {/* Por versão de prompt */}
            <section className="pb-8">
              <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                por versão · {segmentLabel}
              </h2>
              <p className="pb-3 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
                LLM: versão do prompt do cartucho. Código + JEV: fonte de λ, versão dos
                julgamentos e dos pesos (o narrador não mexe no número).
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-body-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                      <Th>versão</Th>
                      <Th align="right">n</Th>
                      <Th align="right">LL modelo</Th>
                      <Th align="right">LL mercado</Th>
                      <Th align="right">Brier mod.</Th>
                      <Th align="right">Brier merc.</Th>
                      <Th align="right">slope</Th>
                      <Th align="right">skill LL</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byVersion.map((g) => (
                      <VersionRow key={g.version} g={g} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Confiabilidade agregada (10 bins) */}
            <section className="pb-8">
              <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                confiabilidade do modelo · {segmentLabel} · 10 bins
              </h2>
              <p className="pb-3 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
                Bem calibrado ⇒ previsto ≈ observado em cada faixa. Faixas vazias omitidas.
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-body-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                      <Th>faixa P(over)</Th>
                      <Th align="right">n</Th>
                      <Th align="right">previsto</Th>
                      <Th align="right">observado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {overall.model.bins
                      .filter((b) => b.n > 0)
                      .map((b) => (
                        <BinRow key={b.lo} b={b} />
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Gates da Fase C (ADR 0039). O Dixon-Coles é julgado por backtest offline; aqui só
// o Kelly, que depende do dado ao vivo. "pronto" não liga nada: é o sinal pra abrir
// o build do Kelly. As bandas do ADR 0019 seguem até lá.
function GateSection({ gate }: { gate: KellyGate }) {
  return (
    <section className="pb-8">
      <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        gate do kelly · {gate.ready ? "pronto" : "ainda não"}
      </h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-body-sm tabular-nums">
          <tbody>
            {gate.checks.map((c) => (
              <tr key={c.key} className="border-b border-border last:border-b-0">
                <Td>{c.label}</Td>
                <Td align="right">{c.detail}</Td>
                <Td align="right">
                  <span
                    className={
                      c.pass ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    {c.pass ? "ok" : "falta"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pt-2 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
        CLV = Δ no-vig contra a linha de fechamento (+ = bateu o mercado). Skill =
        log-loss do mercado − do modelo por análise de over/under, passes incluídos.
        Todos os motores juntos, sem recorte: é o mesmo gate que o predict lê pra
        ligar o quarter-Kelly. O Dixon-Coles é validado por backtest (ADR 0039),
        não por este gate.
      </p>
    </section>
  );
}

// Backtest offline compartilhado Fase C ↔ ADR 0041 §7 (report 10). Estático: o
// report é um snapshot versionado; a manchete só muda com um run novo.
function BacktestSection() {
  return (
    <section className="pb-8">
      <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        backtest offline · fase c
      </h2>
      <p className="text-meta leading-relaxed text-muted-fg-2 tracking-tight">
        Dixon-Coles vs λ heurístico, 987 jogos do Brasileirão 2023–25 em
        walk-forward: log-loss −0.011 em over 2.5 e −0.042 em 1X2 (IC 90% abaixo
        de 0 → GO); no 1X2 o fechamento ainda bate o DC por ~0.02.{" "}
        <a
          href={BACKTEST_REPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
        >
          report 10
        </a>
      </p>
    </section>
  );
}

// Comparação ao vivo dos motores (ADR 0041 §5, #513) + o seletor de recorte. Sempre
// as duas linhas: o motor sem amostra mostra "—" em vez de sumir da comparação.
function EngineSection({
  engines,
  unattributed,
  segment,
}: {
  engines: EngineCalibration[];
  unattributed: number;
  segment: EngineSegment;
}) {
  return (
    <section className="pb-8">
      <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        por motor
      </h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-body-sm tabular-nums">
          <thead>
            <tr className="border-b border-border text-left font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              <Th>motor</Th>
              <Th align="right">n</Th>
              <Th align="right">apostas</Th>
              <Th align="right">LL modelo</Th>
              <Th align="right">LL mercado</Th>
              <Th align="right">Brier mod.</Th>
              <Th align="right">slope</Th>
              <Th align="right">skill LL</Th>
            </tr>
          </thead>
          <tbody>
            {engines.map((e) => (
              <EngineRow key={e.engine} e={e} />
            ))}
          </tbody>
        </table>
      </div>
      <nav
        aria-label="Recorte por motor"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 font-mono text-eyebrow uppercase tracking-label"
      >
        <span className="text-muted-fg-2">recorte:</span>
        <SegmentLink
          href="/admin/calibration"
          label="todos"
          active={segment === "all"}
        />
        {ANALYSIS_ENGINES.map((engine) => (
          <SegmentLink
            key={engine}
            href={`/admin/calibration?engine=${engine}`}
            label={ANALYSIS_ENGINE_LABEL[engine]}
            active={segment === engine}
          />
        ))}
      </nav>
      {unattributed > 0 && (
        <p className="pt-2 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
          {unattributed} predição(ões) com motor desconhecido no modelVersion:
          entram em todos, fora dos recortes.
        </p>
      )}
    </section>
  );
}

function SegmentLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "text-foreground underline underline-offset-4"
          : "text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
}

function EngineRow({ e }: { e: EngineCalibration }) {
  const g = e.group;
  return (
    <tr className="border-b border-border last:border-b-0">
      <Td>{ANALYSIS_ENGINE_LABEL[e.engine]}</Td>
      <Td align="right">{g?.n ?? 0}</Td>
      <Td align="right">{e.bets}</Td>
      <Td align="right">{g ? fmt3(g.model.logLoss) : "—"}</Td>
      <Td align="right">{g ? fmt3(g.market.logLoss) : "—"}</Td>
      <Td align="right">{g ? fmt3(g.model.brier) : "—"}</Td>
      <Td align="right">{g ? fmt3(g.model.slope) : "—"}</Td>
      <Td align="right">
        {g ? (
          <span
            className={
              g.logLossSkill >= 0 ? "text-foreground" : "text-muted-foreground"
            }
          >
            {fmtSkill(g.logLossSkill)}
          </span>
        ) : (
          "—"
        )}
      </Td>
    </tr>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-background px-4 py-3">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className="text-body font-medium tabular-nums">{value}</span>
      {hint && (
        <span className="font-mono text-eyebrow-xs text-muted-fg-2">{hint}</span>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 font-normal ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td className={`px-3 py-2 ${align === "right" ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

function VersionRow({ g }: { g: CalibrationGroup }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <Td>
        <span className="font-mono text-meta">{g.version}</span>
      </Td>
      <Td align="right">{g.n}</Td>
      <Td align="right">{fmt3(g.model.logLoss)}</Td>
      <Td align="right">{fmt3(g.market.logLoss)}</Td>
      <Td align="right">{fmt3(g.model.brier)}</Td>
      <Td align="right">{fmt3(g.market.brier)}</Td>
      <Td align="right">{fmt3(g.model.slope)}</Td>
      <Td align="right">
        <span
          className={
            g.logLossSkill >= 0 ? "text-foreground" : "text-muted-foreground"
          }
        >
          {fmtSkill(g.logLossSkill)}
        </span>
      </Td>
    </tr>
  );
}

function BinRow({ b }: { b: ReliabilityBin }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <Td>
        <span className="font-mono text-meta">
          {`${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}%`}
        </span>
      </Td>
      <Td align="right">{b.n}</Td>
      <Td align="right">{fmtPct(b.meanForecast)}</Td>
      <Td align="right">{fmtPct(b.meanOutcome)}</Td>
    </tr>
  );
}
