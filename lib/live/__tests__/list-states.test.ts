import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries/ai-config", () => ({ getEnableLiveMode: vi.fn() }));
vi.mock("@/lib/live/in-play-state", () => ({
  getInPlayStatesForMatches: vi.fn(),
  getInPlayState: vi.fn(() => {
    throw new Error("as listas nunca buscam no provider");
  }),
}));

import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { getInPlayStatesForMatches } from "@/lib/live/in-play-state";
import { loadListInPlayStates } from "@/lib/live/list-states";

const mockLiveMode = vi.mocked(getEnableLiveMode);
const mockRead = vi.mocked(getInPlayStatesForMatches);

const NOW = new Date("2026-10-15T20:00:00.000Z");
const past = new Date(NOW.getTime() - 30 * 60_000);
const future = new Date(NOW.getTime() + 30 * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveMode.mockResolvedValue(true);
  mockRead.mockResolvedValue(new Map());
});

describe("loadListInPlayStates (#580)", () => {
  it("lê só os jogos já apitados e ainda não encerrados no banco", async () => {
    await loadListInPlayStates(
      [
        { id: "live", kickoffAt: past, status: "live" },
        { id: "late-sync", kickoffAt: past, status: "scheduled" },
        { id: "upcoming", kickoffAt: future, status: "scheduled" },
        { id: "done", kickoffAt: past, status: "finished" },
        { id: "off", kickoffAt: past, status: "postponed" },
      ],
      NOW
    );
    expect(mockRead).toHaveBeenCalledWith(["live", "late-sync"], { now: NOW });
  });

  it("nenhum jogo apitado: nem lê a flag", async () => {
    const out = await loadListInPlayStates(
      [{ id: "upcoming", kickoffAt: future, status: "scheduled" }],
      NOW
    );
    expect(out.size).toBe(0);
    expect(mockLiveMode).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("flag desligada: mapa vazio, sem leitura", async () => {
    mockLiveMode.mockResolvedValue(false);
    const out = await loadListInPlayStates(
      [{ id: "live", kickoffAt: past, status: "live" }],
      NOW
    );
    expect(out.size).toBe(0);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("falha de leitura não derruba a lista", async () => {
    mockRead.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await loadListInPlayStates(
      [{ id: "live", kickoffAt: past, status: "live" }],
      NOW
    );
    expect(out.size).toBe(0);
    spy.mockRestore();
  });
});

describe("guarda de fonte: as listas não buscam estado no provider", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  it.each([
    "app/(app)/jogos/page.tsx",
    "app/(app)/time/[team]/page.tsx",
    "lib/live/list-states.ts",
  ])("%s", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).not.toMatch(/\bgetInPlayState\b/);
    // Só o tipo de liga é permitido (constante, sem cliente).
    expect(src).not.toMatch(/@\/lib\/providers\/(?!sports-data\/leagues")/);
    expect(src).not.toMatch(/ensureOddsSnapshotsFresh|@\/lib\/odds\/fetch-and-snapshot/);
  });
});
