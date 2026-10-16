import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(_key?: unknown) {
      void _key;
    }
  },
}));

import {
  buildModelVersionsAlert,
  sendModelVersionsAlert,
  type ModelVersionsAlertEvents,
} from "../model-versions-alert";

const ADOPTED: ModelVersionsAlertEvents = {
  adopted: [
    { id: "claude-sonnet-5-6", pinnedId: "claude-sonnet-5-5", inputPricePerMTok: 2, outputPricePerMTok: 10 },
  ],
  failed: [],
  pinnedMissing: [],
};

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "e1" }, error: null });
  vi.stubEnv("SPEND_ALERT_EMAIL", "dono@x.com");
  vi.stubEnv("RESEND_FROM_EMAIL", "bot@x.com");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildModelVersionsAlert (ADR 0062, S1)", () => {
  it("adotada: pede a confirmação do preço estimado", () => {
    const { subject, text } = buildModelVersionsAlert(ADOPTED);
    expect(subject).toBe("[Palpiteiro] Modelos: versão nova em uso: claude-sonnet-5-6");
    expect(text).toContain("claude-sonnet-5-6 (fallback: claude-sonnet-5-5)");
    expect(text).toContain("Preço ESTIMADO");
    expect(text).toContain("Confirme o preço oficial em /admin/settings");
  });

  it("reprovada e conferida fora da API entram no mesmo e-mail", () => {
    const { subject, text } = buildModelVersionsAlert({
      adopted: [],
      failed: [{ id: "claude-opus-5-6", reason: "regressão: 4/10" }],
      pinnedMissing: ["claude-haiku-5-5"],
    });
    expect(subject).toContain("versão reprovada: claude-opus-5-6");
    expect(subject).toContain("conferida fora da API: claude-haiku-5-5");
    expect(text).toContain("- claude-opus-5-6: regressão: 4/10");
    expect(text).toContain("- claude-haiku-5-5");
  });
});

describe("sendModelVersionsAlert", () => {
  it("sem evento → não envia", async () => {
    expect(
      await sendModelVersionsAlert({ adopted: [], failed: [], pinnedMissing: [] }),
    ).toEqual({ skipped: "nothing_to_send" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("envia pro mesmo destinatário do alerta de gasto", async () => {
    expect(await sendModelVersionsAlert(ADOPTED)).toEqual({ sent: true });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "bot@x.com", to: "dono@x.com" }),
    );
  });

  it("sem destinatário ou remetente → não envia", async () => {
    vi.stubEnv("SPEND_ALERT_EMAIL", "");
    expect(await sendModelVersionsAlert(ADOPTED)).toEqual({ skipped: "no_recipient" });
    vi.stubEnv("SPEND_ALERT_EMAIL", "dono@x.com");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    expect(await sendModelVersionsAlert(ADOPTED)).toEqual({ skipped: "no_from_address" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("erro do Resend (resolvido como { error }) lança, pra o cron registrar", async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: "x", message: "quota" } });
    await expect(sendModelVersionsAlert(ADOPTED)).rejects.toThrow("quota");
  });
});
