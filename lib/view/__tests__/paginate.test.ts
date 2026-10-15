import { describe, expect, it } from "vitest";

import { paginate } from "@/lib/view/paginate";

const items = Array.from({ length: 60 }, (_, i) => i);

describe("paginate", () => {
  it("vazio: uma página, sem itens", () => {
    expect(paginate([], undefined)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
    expect(paginate([], "3")).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });

  it("primeira página por padrão, 25 por página", () => {
    const p = paginate(items, undefined);
    expect(p.items).toEqual(items.slice(0, 25));
    expect(p).toMatchObject({ page: 1, pageCount: 3, total: 60 });
  });

  it.each(["0", "-1", "abc", "NaN", "1.5", ""])("página inválida %j → 1", (raw) => {
    expect(paginate(items, raw).page).toBe(1);
  });

  it("última página traz o resto", () => {
    const p = paginate(items, "3");
    expect(p.items).toEqual(items.slice(50));
    expect(p.page).toBe(3);
  });

  it("além da última → a última", () => {
    expect(paginate(items, "99").page).toBe(3);
  });

  it("tamanho de página próprio", () => {
    expect(paginate(items, "2", 10).items).toEqual(items.slice(10, 20));
    expect(paginate(items, "2", 10).pageCount).toBe(6);
  });
});
