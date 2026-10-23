// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeForSearch,
  searchSettings,
  SETTINGS_INDEX,
} from "@/lib/admin/settings-index";
import { ADMIN_FLAGS } from "@/lib/config/admin-flags";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";

const ROOT = process.cwd();
const APP = join(ROOT, "app", "(app)");

/** Fontes da própria rota (page.tsx e os componentes locais, sem as sub-rotas). */
function routeSource(path: string): string {
  const dir = join(APP, ...path.split("/").filter(Boolean));
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((f) => statSync(f).isFile() && /\.tsx?$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

const FLAG_LIST_SRC = readFileSync(
  join(ROOT, "components", "admin", "flag-list.tsx"),
  "utf8"
);

const ids = (results: { id: string }[]) => results.map((r) => r.id);

describe("SETTINGS_INDEX", () => {
  it("tem ids únicos", () => {
    const all = SETTINGS_INDEX.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("cobre toda flag do registry e toda liga suportada", () => {
    for (const flag of ADMIN_FLAGS) {
      expect(SETTINGS_INDEX.some((e) => e.id === `flag:${flag.key}`)).toBe(
        true
      );
    }
    for (const league of SUPPORTED_LEAGUES) {
      expect(SETTINGS_INDEX.some((e) => e.id === `league:${league}`)).toBe(
        true
      );
    }
  });

  it("aponta só pra páginas que existem", () => {
    for (const entry of SETTINGS_INDEX) {
      const path = entry.href.split("#")[0] ?? entry.href;
      const page = join(APP, ...path.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(page), `${entry.id} → ${path}`).toBe(true);
    }
  });

  it("toda âncora existe na página de destino", () => {
    for (const entry of SETTINGS_INDEX) {
      const [path, anchor] = entry.href.split("#");
      if (!anchor || !path) continue;
      const src = routeSource(path);
      if (anchor.startsWith("flag-")) {
        // id gerado no FlagList, que a página tem que renderizar com a área da flag.
        const flag = ADMIN_FLAGS.find((f) => `flag-${f.key}` === anchor);
        expect(flag, anchor).toBeDefined();
        expect(FLAG_LIST_SRC).toContain("id={flagAnchorId(flag.key)}");
        expect(src).toContain(`<FlagList area="${flag?.area}"`);
      } else if (anchor.startsWith("liga-")) {
        expect(src).toContain("id={leagueAnchorId(s.league)}");
      } else {
        expect(src, `${entry.id} → #${anchor}`).toContain(`id="${anchor}"`);
      }
    }
  });
});

describe("searchSettings", () => {
  it("consulta vazia ou sem resultado devolve nada", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("ignora acento e caixa", () => {
    expect(normalizeForSearch("Calibração")).toBe("calibracao");
    expect(ids(searchSettings("CALIBRACAO"))[0]).toBe("calibration");
  });

  it("acha a flag pelo rótulo e pela chave", () => {
    expect(ids(searchSettings("ao vivo"))[0]).toBe("flag:enableLiveMode");
    expect(ids(searchSettings("enableLiveMode"))[0]).toBe(
      "flag:enableLiveMode"
    );
  });

  it("acha pelo sinônimo que não está na tela", () => {
    expect(ids(searchSettings("max_tokens"))[0]).toBe("generation-params");
    expect(ids(searchSettings("refit"))[0]).toBe("dixon-coles");
    expect(ids(searchSettings("cota"))[0]).toBe("odds-budget");
  });

  it("liga pelo nome vai pra linha da liga", () => {
    expect(ids(searchSettings("la liga"))[0]).toBe("league:la_liga");
    expect(searchSettings("brasileirao")[0]?.href).toBe(
      "/admin/leagues#liga-bsa"
    );
  });

  it("todas as palavras têm que casar", () => {
    const results = searchSettings("modelo perfil");
    expect(ids(results)[0]).toBe("profile-model");
    const text = (r: (typeof results)[number]) =>
      normalizeForSearch(
        [r.label, r.where, r.description, ...r.keywords].join(" ")
      );
    expect(
      results.every(
        (r) => text(r).includes("perfil") && text(r).includes("modelo")
      )
    ).toBe(true);
  });

  it("respeita o limite", () => {
    expect(searchSettings("a", { limit: 3 })).toHaveLength(3);
  });
});
