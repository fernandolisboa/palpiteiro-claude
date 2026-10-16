import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/model-versions", () => ({
  confirmModelVersionPriceAction: vi.fn(async () => ({ ok: true })),
  rejectModelVersionAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/db/queries/model-versions", () => ({
  listModelVersions: vi.fn(),
  getModelVersionsCheck: vi.fn(),
}));

import { ModelVersionsPanel } from "@/app/(app)/admin/settings/model-versions-panel";
import {
  getModelVersionsCheck,
  listModelVersions,
  type ModelVersionRow,
} from "@/lib/db/queries/model-versions";

const listMock = vi.mocked(listModelVersions);
const checkMock = vi.mocked(getModelVersionsCheck);

const T = new Date("2026-11-10T08:15:00Z");

function row(over: Partial<ModelVersionRow>): ModelVersionRow {
  return {
    id: "claude-sonnet-5-6",
    family: "sonnet",
    displayName: "x",
    apiCreatedAt: null,
    capabilities: null,
    maxTokens: null,
    status: "active",
    pricing: { inputPricePerMTok: 2, outputPricePerMTok: 10 },
    priceConfirmedAt: null,
    adoptedAt: T,
    failureReason: null,
    probeAiCallId: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

async function render(enabled = true): Promise<string> {
  return renderToStaticMarkup(await ModelVersionsPanel({ enabled }));
}

beforeEach(() => {
  listMock.mockReset();
  checkMock.mockReset();
  listMock.mockResolvedValue([]);
  checkMock.mockResolvedValue({ checkedAt: null, summary: null });
});

describe("ModelVersionsPanel (ADR 0062)", () => {
  it("sem nada adotado: as três conferidas, com preço e selo 'conferida'; cron ainda não rodou", async () => {
    const html = await render();
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      expect(html).toContain(`em uso: ${id}`);
    }
    expect(html.match(/>conferida</g)).toHaveLength(3);
    expect(html).toContain("$2 in / $10 out · 1M");
    expect(html).toContain("prompt &gt; 100K");
    expect(html).not.toContain("estimado");
    expect(html).toContain("o cron ainda não rodou");
  });

  it("versão adotada: automática desde, fallback, preço estimado com o form de confirmar e o botão de rejeitar", async () => {
    listMock.mockResolvedValue([row({})]);
    const html = await render();
    expect(html).toContain("em uso: claude-sonnet-5-6 · fallback: claude-sonnet-5-5");
    expect(html).toContain("automática desde 10 nov · 08:15 UTC");
    expect(html).toContain(">estimado<");
    expect(html).toContain("Confirmar preço");
    expect(html).toContain('name="inputPricePerMTok"');
    expect(html).toContain('value="claude-sonnet-5-6"');
    expect(html).toContain("Rejeitar esta versão");
  });

  it("preço confirmado: sem selo nem form, com a data", async () => {
    listMock.mockResolvedValue([
      row({ pricing: { inputPricePerMTok: 3, outputPricePerMTok: 15 }, priceConfirmedAt: T }),
    ]);
    const html = await render();
    expect(html).toContain("$3 in / $15 out · 1M");
    expect(html).not.toContain(">estimado<");
    expect(html).not.toContain("Confirmar preço");
    expect(html).toContain("Preço confirmado em 10 nov · 08:15 UTC");
    expect(html).toContain("Rejeitar esta versão");
  });

  it("flag desligada: a família roda a conferida e a adotada aparece como pausada", async () => {
    listMock.mockResolvedValue([row({})]);
    const html = await render(false);
    expect(html).toContain("em uso: claude-sonnet-5-5");
    expect(html).toContain("claude-sonnet-5-6 adotada, mas pausada");
    expect(html).toContain("Flag desligada: só as versões conferidas rodam.");
  });

  it("lista as falhas com o motivo", async () => {
    listMock.mockResolvedValue([
      row({ id: "claude-opus-5-6", family: "opus", status: "failed", failureReason: "sondagem: resposta errada (6)" }),
      row({ id: "claude-opus-5-7", family: "opus", status: "failed", failureReason: "rejeitada pelo admin" }),
    ]);
    const html = await render();
    expect(html).toContain("claude-opus-5-6 · sondagem: resposta errada (6)");
    expect(html).toContain("claude-opus-5-7 · rejeitada pelo admin");
    expect(html).toContain("em uso: claude-opus-5-5");
  });

  it("rodapé: última checagem e o resumo", async () => {
    checkMock.mockResolvedValue({
      checkedAt: T,
      summary: {
        status: "ok",
        adopted: ["claude-sonnet-5-6"],
        failed: [],
        transient: [{ id: "claude-haiku-5-6", family: "haiku", since: T.toISOString(), reason: "timeout: t" }],
        pinnedMissing: ["claude-opus-5-5"],
        emailError: "resend fora",
      },
    });
    const html = await render();
    expect(html).toContain("última checagem:");
    expect(html).toContain("1 adotada(s) · 0 reprovada(s) · 1 com erro transitório");
    expect(html).toContain("claude-haiku-5-6: erro transitório desde 10 nov · 08:15 UTC");
    expect(html).toContain("conferida fora da listagem da API: claude-opus-5-5");
    expect(html).toContain("e-mail não enviado: resend fora");
  });

  it("leitura que falha não derruba a página: mostra só as conferidas", async () => {
    listMock.mockRejectedValue(new Error("neon down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("Não foi possível ler as versões");
    expect(html).toContain("em uso: claude-sonnet-5-5");
    warn.mockRestore();
  });
});
