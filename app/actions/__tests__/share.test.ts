// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: as fns precisam existir ANTES do vi.mock hoisted (senão TDZ no factory).
const { auth, getPalpiteSetOwner, setPalpiteSetSharedAt } = vi.hoisted(() => ({
  auth: vi.fn(),
  getPalpiteSetOwner: vi.fn(),
  setPalpiteSetSharedAt: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/queries/palpites", () => ({
  getPalpiteSetOwner,
  setPalpiteSetSharedAt,
}));

import { shareSet } from "@/app/actions/share";

// UUID v4 válido (nibble de versão "4", de variante "8") — z.string().uuid() exige.
const UUID = "11111111-1111-4111-8111-111111111111";
const OWNER = "owner-user-id";

beforeEach(() => {
  auth.mockReset();
  getPalpiteSetOwner.mockReset();
  setPalpiteSetSharedAt.mockReset();
  setPalpiteSetSharedAt.mockResolvedValue(undefined);
});

describe("shareSet — autorização + idempotência (ADR §7, privacy MAJOR 5)", () => {
  it("sem sessão → erro, sem query", async () => {
    auth.mockResolvedValue(null);
    const r = await shareSet(UUID);
    expect(r).toEqual({ ok: false, error: "Sessão inválida." });
    expect(getPalpiteSetOwner).not.toHaveBeenCalled();
  });

  it("id não-UUID → erro ANTES da query (evita 22P02)", async () => {
    auth.mockResolvedValue({ user: { id: OWNER } });
    const r = await shareSet("not-a-uuid");
    expect(r).toEqual({ ok: false, error: "Palpite inválido." });
    expect(getPalpiteSetOwner).not.toHaveBeenCalled();
  });

  it("set inexistente (null) → erro OPACO (colapsa 404), sem carimbar", async () => {
    auth.mockResolvedValue({ user: { id: OWNER } });
    getPalpiteSetOwner.mockResolvedValue(null);
    const r = await shareSet(UUID);
    expect(r).toEqual({
      ok: false,
      error: "Não foi possível compartilhar este palpite.",
    });
    expect(setPalpiteSetSharedAt).not.toHaveBeenCalled();
  });

  it("dono ≠ sessão → MESMO erro opaco (colapsa 403 = 404, fecha o oráculo), sem carimbar", async () => {
    auth.mockResolvedValue({ user: { id: OWNER } });
    getPalpiteSetOwner.mockResolvedValue({
      userId: "outro-usuario",
      sharedAt: null,
    });
    const r = await shareSet(UUID);
    expect(r).toEqual({
      ok: false,
      error: "Não foi possível compartilhar este palpite.",
    });
    expect(setPalpiteSetSharedAt).not.toHaveBeenCalled();
  });

  it("já compartilhado (sharedAt set) → ok SEM re-carimbar (skip-not-restamp)", async () => {
    auth.mockResolvedValue({ user: { id: OWNER } });
    getPalpiteSetOwner.mockResolvedValue({
      userId: OWNER,
      sharedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const r = await shareSet(UUID);
    expect(r).toEqual({ ok: true, path: `/p/${UUID}` });
    expect(setPalpiteSetSharedAt).not.toHaveBeenCalled();
  });

  it("dono + ainda não compartilhado → carimba + ok com path", async () => {
    auth.mockResolvedValue({ user: { id: OWNER } });
    getPalpiteSetOwner.mockResolvedValue({ userId: OWNER, sharedAt: null });
    const r = await shareSet(UUID);
    expect(r).toEqual({ ok: true, path: `/p/${UUID}` });
    expect(setPalpiteSetSharedAt).toHaveBeenCalledTimes(1);
    const [calledId, calledAt] = setPalpiteSetSharedAt.mock.calls[0];
    expect(calledId).toBe(UUID);
    expect(calledAt).toBeInstanceOf(Date);
  });
});
