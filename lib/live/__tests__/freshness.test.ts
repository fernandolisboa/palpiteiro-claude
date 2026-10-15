import { describe, expect, it } from "vitest";

import {
  IN_PLAY_ACT_MAX_AGE_MS,
  IN_PLAY_FRESH_MS,
  IN_PLAY_SHOW_MAX_AGE_MS,
  isLiveStateActionable,
  isLiveStateFresh,
  isLiveStateShowable,
  liveStateAgeMs,
} from "@/lib/live/freshness";

const NOW = new Date("2026-10-15T20:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("idades do estado ao vivo (ADR 0060 §2)", () => {
  it("constantes do plano", () => {
    expect(IN_PLAY_FRESH_MS).toBe(60_000);
    expect(IN_PLAY_ACT_MAX_AGE_MS).toBe(120_000);
    expect(IN_PLAY_SHOW_MAX_AGE_MS).toBe(600_000);
  });

  it("sem busca bem-sucedida: sem idade e nada vale", () => {
    expect(liveStateAgeMs(null, NOW)).toBeNull();
    expect(isLiveStateFresh(null, NOW)).toBe(false);
    expect(isLiveStateActionable(null, NOW)).toBe(false);
    expect(isLiveStateShowable(null, NOW)).toBe(false);
  });

  it("relógio da instância atrás do gravado: idade 0", () => {
    expect(liveStateAgeMs(new Date(NOW.getTime() + 500), NOW)).toBe(0);
  });

  it("limites inclusivos", () => {
    expect(isLiveStateFresh(ago(60_000), NOW)).toBe(true);
    expect(isLiveStateFresh(ago(60_001), NOW)).toBe(false);
    expect(isLiveStateActionable(ago(120_000), NOW)).toBe(true);
    expect(isLiveStateActionable(ago(120_001), NOW)).toBe(false);
    expect(isLiveStateShowable(ago(600_000), NOW)).toBe(true);
    expect(isLiveStateShowable(ago(600_001), NOW)).toBe(false);
  });
});
