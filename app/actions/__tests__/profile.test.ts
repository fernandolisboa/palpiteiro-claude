import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), unstable_update: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({
  updateUser: vi.fn(),
  setPreferredModelId: vi.fn(),
}));
// isModelAllowedForAudience NÃO é mockado de propósito: o gating de audiência é
// a lógica sob teste aqui, então usamos a implementação real do registry.

import { updatePreferredModel, updateProfile } from "@/app/actions/profile";
import { auth, unstable_update } from "@/auth";
import { setPreferredModelId, updateUser } from "@/lib/db/queries/users";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockUpdate = vi.mocked(updateUser);
const mockSessionUpdate = vi.mocked(unstable_update);
const mockSetPreferred = vi.mocked(setPreferredModelId);

const USER = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

const ADMIN = {
  user: { id: "a1", email: "admin@d.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockUpdate.mockReset();
  mockSessionUpdate.mockReset();
  mockSetPreferred.mockReset();
});

describe("updateProfile", () => {
  it("no session → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await updateProfile(null, form({ name: "Fulano" }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid name → updateUser called with session id + null image, session refreshed, ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "Fulano" }));
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      user: { name: "Fulano", image: null },
    });
  });

  it("owner gate: writes to the SESSION id, never an id smuggled in the form", async () => {
    mockAuth.mockResolvedValue(USER);
    await updateProfile(null, form({ name: "Fulano", id: "someone-else" }));
    expect(mockUpdate).toHaveBeenCalledWith("u2", expect.anything());
  });

  it("name with surrounding whitespace → trimmed", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "  Fulano  " }));
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
  });

  it("empty/whitespace name → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "   " }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("name longer than 80 chars → not ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(null, form({ name: "x".repeat(81) }));
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("valid name + valid image URL → image persisted and session refreshed with it", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(
      null,
      form({ name: "Fulano", image: "https://x.com/a.png" })
    );
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: "https://x.com/a.png",
    });
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      user: { name: "Fulano", image: "https://x.com/a.png" },
    });
  });

  it("invalid image URL → not ok and updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateProfile(
      null,
      form({ name: "Fulano", image: "not-a-url" })
    );
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("blank image → persisted as null (falls back to initials)", async () => {
    mockAuth.mockResolvedValue(USER);
    await updateProfile(null, form({ name: "Fulano", image: "   " }));
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
  });

  it("non-http(s) avatar scheme (javascript:/mailto:/data:) → not ok, updateUser NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    for (const bad of [
      "javascript:alert(1)",
      "mailto:a@b.com",
      "data:text/html,x",
    ]) {
      const res = await updateProfile(
        null,
        form({ name: "Fulano", image: bad })
      );
      expect(res.ok).toBe(false);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("session refresh failure does not fail the save (DB is the source of truth)", async () => {
    mockAuth.mockResolvedValue(USER);
    mockSessionUpdate.mockRejectedValueOnce(new Error("edge refresh failed"));
    const res = await updateProfile(null, form({ name: "Fulano" }));
    expect(res).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith("u2", {
      name: "Fulano",
      image: null,
    });
  });

  it("não toca em setPreferredModelId (ações isoladas)", async () => {
    mockAuth.mockResolvedValue(USER);
    await updateProfile(null, form({ name: "Fulano" }));
    expect(mockSetPreferred).not.toHaveBeenCalled();
  });
});

describe("updatePreferredModel — preferência pessoal de modelo (ADR 0013)", () => {
  it("no session → not ok and setPreferredModelId NOT called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-haiku-5-5" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetPreferred).not.toHaveBeenCalled();
  });

  it("usuário comum + Haiku 5.5 (userSelectable) → grava o id na sessão; ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-haiku-5-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetPreferred).toHaveBeenCalledWith("u2", "claude-haiku-5-5");
  });

  it("usuário comum + Fable (fora do app, ADR 0061) → aceito como Opus 5.5 e é ISSO que grava", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-fable-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetPreferred).toHaveBeenCalledWith("u2", "claude-opus-5-5");
  });

  it("usuário comum + id antigo (aba aberta antes do deploy, ADR 0061) → grava o 5.5 da família, nunca o id cru", async () => {
    const cases: [string, string][] = [
      ["claude-sonnet-5", "claude-sonnet-5-5"],
      ["claude-sonnet-4-5-20250929", "claude-sonnet-5-5"],
      ["claude-haiku-4-5", "claude-haiku-5-5"],
    ];
    mockAuth.mockResolvedValue(USER);
    for (const [raw, resolved] of cases) {
      mockSetPreferred.mockClear();
      const res = await updatePreferredModel(
        null,
        form({ preferredModelId: raw }),
      );
      expect(res).toEqual({ ok: true });
      expect(mockSetPreferred).toHaveBeenCalledTimes(1);
      expect(mockSetPreferred).toHaveBeenCalledWith("u2", resolved);
    }
  });

  it("'default' → grava null (limpa a preferência); ok", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "default" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetPreferred).toHaveBeenCalledWith("u2", null);
  });

  it("vazio → grava null (limpa a preferência)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(null, form({ preferredModelId: "" }));
    expect(res).toEqual({ ok: true });
    expect(mockSetPreferred).toHaveBeenCalledWith("u2", null);
  });

  it("id desconhecido (fora do registry) → erro, NÃO grava", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-nope-9" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetPreferred).not.toHaveBeenCalled();
  });

  it("admin + Opus 5.5 (id do registry) → grava o id; ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-opus-5-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetPreferred).toHaveBeenCalledWith("a1", "claude-opus-5-5");
  });

  it("id não-Claude (gpt-5-mini antigo) → erro, NÃO grava", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updatePreferredModel(
      null,
      form({ preferredModelId: "gpt-5-mini" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetPreferred).not.toHaveBeenCalled();
  });

  it("gate por dono: grava no id da SESSÃO, nunca num id smuggled no form", async () => {
    mockAuth.mockResolvedValue(USER);
    await updatePreferredModel(
      null,
      form({ preferredModelId: "claude-haiku-5-5", id: "someone-else" }),
    );
    expect(mockSetPreferred).toHaveBeenCalledWith("u2", "claude-haiku-5-5");
  });
});
