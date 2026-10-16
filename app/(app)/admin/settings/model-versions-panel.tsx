import { DefinitionRow } from "@/components/admin/definition-row";
import { Badge } from "@/components/ui/badge";
import { adoptedModelFromRow } from "@/lib/ai/model-versions/active";
import {
  MODEL_FAMILIES,
  type ModelVersionsCheckSummary,
} from "@/lib/ai/model-versions/types";
import { pinnedModelFor, type AIModel, type ModelFamily } from "@/lib/ai/models";
import {
  getModelVersionsCheck,
  listModelVersions,
  type ModelVersionRow,
  type ModelVersionsCheck,
} from "@/lib/db/queries/model-versions";
import { formatGeneratedAt, formatRelativeAgoLabel } from "@/lib/format";

import { ConfirmPriceForm, RejectVersionButton } from "./model-version-actions";

// Quantas falhas por família o painel mostra (as mais novas).
const MAX_FAILURES_SHOWN = 5;

type PanelData = { rows: ModelVersionRow[]; check: ModelVersionsCheck };

// Telemetria: falha de leitura não pode derrubar a página de configurações.
async function readData(): Promise<PanelData | null> {
  try {
    const [rows, check] = await Promise.all([
      listModelVersions(),
      getModelVersionsCheck(),
    ]);
    return { rows, check };
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "admin_settings",
        warning: "falha ao ler model_versions",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

function priceText(m: Pick<AIModel, "inputPricePerMTok" | "outputPricePerMTok" | "longPromptPricing">): string {
  const long = m.longPromptPricing
    ? ` (prompt > ${m.longPromptPricing.aboveInputTokens / 1000}K: $${m.longPromptPricing.inputPricePerMTok} / $${m.longPromptPricing.outputPricePerMTok})`
    : "";
  return `$${m.inputPricePerMTok} in / $${m.outputPricePerMTok} out · 1M${long}`;
}

function utc(d: Date): string {
  return `${formatGeneratedAt(d, "UTC")} UTC`;
}

function summaryText(s: ModelVersionsCheckSummary): string[] {
  const lines: string[] = [];
  if (s.status === "disabled") lines.push("flag desligada: nada foi sondado");
  if (s.status === "listing_failed") lines.push("a listagem da API falhou");
  lines.push(
    `${s.adopted.length} adotada(s) · ${s.failed.length} reprovada(s) · ${s.transient.length} com erro transitório`,
  );
  for (const t of s.transient) {
    lines.push(`${t.id}: erro transitório desde ${utc(new Date(t.since))} (${t.reason})`);
  }
  if (s.pinnedMissing.length > 0) {
    lines.push(`conferida fora da listagem da API: ${s.pinnedMissing.join(", ")}`);
  }
  if (s.error) lines.push(`erro: ${s.error}`);
  if (s.emailError) lines.push(`e-mail não enviado: ${s.emailError}`);
  return lines;
}

function FamilyRow({
  family,
  rows,
  enabled,
}: {
  family: ModelFamily;
  rows: ModelVersionRow[];
  enabled: boolean;
}) {
  const pinned = pinnedModelFor(family);
  const activeRow = rows.find((r) => r.status === "active");
  const adopted = activeRow ? adoptedModelFromRow(activeRow) : null;
  const inUse = enabled && adopted ? adopted : null;
  const since = activeRow ? (activeRow.adoptedAt ?? activeRow.createdAt) : null;
  const failures = rows
    .filter((r) => r.status === "failed")
    .slice(0, MAX_FAILURES_SHOWN);

  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <DefinitionRow
        className="items-start gap-4 border-b-0 py-0"
        label={
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-body font-medium">
              {pinned.label}
              {inUse && since ? (
                <Badge variant="secondary" size="sm">
                  automática desde {utc(since)}
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">
                  conferida
                </Badge>
              )}
            </span>
            <span className="font-mono text-meta text-muted-foreground">
              em uso: {(inUse ?? pinned).id}
              {inUse ? ` · fallback: ${pinned.id}` : ""}
            </span>
            {!enabled && adopted && (
              <span className="text-body-sm text-muted-foreground">
                {adopted.id} adotada, mas pausada: a flag está desligada.
              </span>
            )}
          </div>
        }
        value={
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-2 font-mono text-meta tabular-nums text-muted-foreground">
              {priceText(inUse ?? pinned)}
              {inUse?.adopted?.priceEstimated && (
                <Badge variant="outline" size="sm" className="border-warn-border text-warn-fg">
                  estimado
                </Badge>
              )}
            </span>
          </div>
        }
      />
      {adopted && activeRow && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          {adopted.adopted?.priceEstimated ? (
            <div className="flex flex-col gap-1">
              <p className="text-body-sm text-muted-foreground">
                Preço herdado da conferida. Confirme o oficial da Anthropic (os
                custos já gravados não mudam).
              </p>
              <ConfirmPriceForm
                id={adopted.id}
                inputPricePerMTok={adopted.inputPricePerMTok}
                outputPricePerMTok={adopted.outputPricePerMTok}
              />
            </div>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              Preço confirmado
              {activeRow.priceConfirmedAt ? ` em ${utc(activeRow.priceConfirmedAt)}` : ""}.
            </p>
          )}
          <RejectVersionButton id={adopted.id} />
        </div>
      )}
      {failures.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label={`falhas do ${pinned.label}`}>
          {failures.map((f) => (
            <li key={f.id} className="font-mono text-meta text-muted-foreground">
              {f.id} · {f.failureReason ?? "reprovada"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Versões de Haiku, Sonnet e Opus em uso (ADR 0062): a automática ou a conferida, o
 * fallback, o preço (com selo "estimado" até ser confirmado), as falhas e a última
 * checagem do cron.
 */
export async function ModelVersionsPanel({ enabled }: { enabled: boolean }) {
  const data = await readData();
  const now = new Date();
  const checkedAt = data?.check.checkedAt ?? null;
  const summary = data?.check.summary ?? null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-muted-foreground">
        O cron diário (08:15 UTC) testa a versão nova de cada família e a adota se
        passar; se ela falhar, a família volta sozinha pra versão conferida. Vale
        também pra escolha do admin: pra forçar a conferida, desligue a flag ou
        rejeite a versão.
      </p>
      {!enabled && (
        <p className="text-body-sm text-destructive">
          Flag desligada: só as versões conferidas rodam.
        </p>
      )}
      <div className="rounded-md border border-border">
        {data === null && (
          <p className="px-4 py-3 text-body-sm text-destructive">
            Não foi possível ler as versões. Mostrando só as conferidas.
          </p>
        )}
        {MODEL_FAMILIES.map((family) => (
          <FamilyRow
            key={family}
            family={family}
            rows={(data?.rows ?? []).filter((r) => r.family === family)}
            enabled={enabled && data !== null}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5 font-mono text-meta text-muted-foreground">
        {checkedAt ? (
          <span>última checagem: {formatRelativeAgoLabel(checkedAt, now)} ({utc(checkedAt)})</span>
        ) : (
          <span>o cron ainda não rodou</span>
        )}
        {summary && summaryText(summary).map((line) => <span key={line}>{line}</span>)}
      </div>
    </div>
  );
}
