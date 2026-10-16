import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/model-versions/active", () => ({
  resetActiveModelMemo: vi.fn(),
}));
vi.mock("@/lib/db/queries/model-versions", () => ({
  confirmModelVersionPrice: vi.fn(async () => true),
  rejectModelVersion: vi.fn(async () => true),
}));

import {
  confirmModelVersionPriceAction,
  rejectModelVersionAction,
} from "@/app/actions/model-versions";
import { auth } from "@/auth";
import { resetActiveModelMemo } from "@/lib/ai/model-versions/active";
import {
  confirmModelVersionPrice,
  rejectModelVersion,
} from "@/lib/db/queries/model-versions";
import { revalidatePath } from "next/cache";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const confirmMock = vi.mocked(confirmModelVersionPrice);
const rejectMock = vi.mocked(rejectModelVersion);
const resetMock = vi.mocked(resetActiveModelMemo);
const revalidateMock = vi.mocked(revalidatePath);

const ADMIN = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;
const USER = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  rejectMock.mockReset();
  rejectMock.mockResolvedValue(true);
  resetMock.mockReset();
  revalidateMock.mockReset();
});

const VALID = {
  id: "claude-sonnet-5-6",
  inputPricePerMTok: "2.5",
  outputPricePerMTok: "12",
};

describe("confirmModelVersionPriceAction (ADR 0062)", () => {
  it("não-admin → acesso negado, nada gravado", async () => {
    mockAuth.mockResolvedValue(USER);
    expect(await confirmModelVersionPriceAction(null, form(VALID))).toEqual({
      ok: false,
      error: "Acesso negado.",
    });
    mockAuth.mockResolvedValue(null);
    expect((await confirmModelVersionPriceAction(null, form(VALID))).ok).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("admin + preço válido → grava, zera o memo e revalida", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect(await confirmModelVersionPriceAction(null, form(VALID))).toEqual({ ok: true });
    expect(confirmMock).toHaveBeenCalledWith("claude-sonnet-5-6", {
      inputPricePerMTok: 2.5,
      outputPricePerMTok: 12,
    });
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith("/admin/settings");
  });

  it.each([
    ["preço vazio", { ...VALID, inputPricePerMTok: "" }],
    ["preço negativo", { ...VALID, outputPricePerMTok: "-1" }],
    ["preço não numérico", { ...VALID, inputPricePerMTok: "abc" }],
    ["preço absurdo", { ...VALID, inputPricePerMTok: "5000" }],
    ["id fora do formato", { ...VALID, id: "gpt-5" }],
  ])("%s → erro, nada gravado", async (_l, fields) => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await confirmModelVersionPriceAction(null, form(fields))).ok).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("versão inexistente → erro, sem reset", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    confirmMock.mockResolvedValue(false);
    expect(await confirmModelVersionPriceAction(null, form(VALID))).toEqual({
      ok: false,
      error: "Versão não encontrada.",
    });
    expect(resetMock).not.toHaveBeenCalled();
  });
});

describe("rejectModelVersionAction (ADR 0062)", () => {
  it("não-admin → acesso negado", async () => {
    mockAuth.mockResolvedValue(USER);
    expect((await rejectModelVersionAction(null, form({ id: VALID.id }))).ok).toBe(false);
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("admin → rejeita, zera o memo e revalida", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect(await rejectModelVersionAction(null, form({ id: VALID.id }))).toEqual({ ok: true });
    expect(rejectMock).toHaveBeenCalledWith("claude-sonnet-5-6");
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith("/admin/settings");
  });

  it("id inválido ou versão já reprovada → erro, sem reset", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await rejectModelVersionAction(null, form({ id: "lixo" }))).ok).toBe(false);
    expect(rejectMock).not.toHaveBeenCalled();
    rejectMock.mockResolvedValue(false);
    expect((await rejectModelVersionAction(null, form({ id: VALID.id }))).ok).toBe(false);
    expect(resetMock).not.toHaveBeenCalled();
  });
});
