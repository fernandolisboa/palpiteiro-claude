// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import {
  LIVE_REVISIT_MAX_AGE_MS,
  markRouterCacheStale,
  notePrefetch,
  notePrefetchCacheCleared,
  resetRouterCacheState,
  REVISIT_MAX_AGE_MS,
  shouldRevalidate,
} from "@/lib/nav/router-cache";

const T0 = 1_000_000;

describe("shouldRevalidate (#639)", () => {
  beforeEach(() => resetRouterCacheState());

  it("render novo (1ª montagem) não relê: acabou de vir do servidor", () => {
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0)).toBe(false);
  });

  it("reaberta do cache antes de 30s: fica como está", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 29_999)).toBe(false);
  });

  it("reaberta do cache com 30s ou mais: relê em segundo plano", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 30_000)).toBe(true);
  });

  it("a idade conta da 1ª vez que o id foi visto, não da última", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 20_000);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 31_000)).toBe(true);
  });

  it("jogo ao vivo: qualquer reabertura depois de 1s relê", () => {
    shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0 + 999)).toBe(false);
    expect(shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0 + 1_000)).toBe(true);
  });

  it("ids diferentes são independentes (cada render do servidor é um)", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("b", REVISIT_MAX_AGE_MS, T0 + 60_000)).toBe(false);
  });

  it("gravação fora do servidor: o que já estava guardado relê mesmo novo", () => {
    shouldRevalidate("antes", REVISIT_MAX_AGE_MS, T0);
    markRouterCacheStale(T0 + 5_000);
    expect(shouldRevalidate("antes", REVISIT_MAX_AGE_MS, T0 + 6_000)).toBe(true);
  });

  it("gravação fora do servidor: render visto depois da marca não relê", () => {
    markRouterCacheStale(T0);
    shouldRevalidate("depois", REVISIT_MAX_AGE_MS, T0 + 10);
    expect(shouldRevalidate("depois", REVISIT_MAX_AGE_MS, T0 + 1_000)).toBe(false);
  });

  it("guarda os ids por quantidade (500), não por idade: o voltar remonta páginas velhas", () => {
    shouldRevalidate("velho", REVISIT_MAX_AGE_MS, T0);
    const hoursLater = T0 + 3 * 60 * 60 * 1000;
    shouldRevalidate("outro", REVISIT_MAX_AGE_MS, hoursLater);
    expect(shouldRevalidate("velho", REVISIT_MAX_AGE_MS, hoursLater + 1)).toBe(true);
  });

  it("acima de 500 ids, esquece o mais antigo", () => {
    shouldRevalidate("primeiro", REVISIT_MAX_AGE_MS, T0);
    for (let i = 0; i < 500; i++) shouldRevalidate(`id${i}`, REVISIT_MAX_AGE_MS, T0 + 1);
    expect(shouldRevalidate("primeiro", REVISIT_MAX_AGE_MS, T0 + 60_000)).toBe(false);
  });
});

describe("idade de página buscada por intenção (#639)", () => {
  beforeEach(() => resetRouterCacheState());
  const URL_A = "/match/1?back=%2Fjogos";

  it("buscada com o mouse há 4 min e aberta agora: já nasce velha e relê", () => {
    notePrefetch(URL_A, T0);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 240_000, URL_A)).toBe(true);
  });

  it("buscada há 10s: abre como nova", () => {
    notePrefetch(URL_A, T0);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 10_000, URL_A)).toBe(false);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 30_000, URL_A)).toBe(true);
  });

  it("jogo ao vivo buscado com o mouse: relê na hora de abrir", () => {
    notePrefetch(URL_A, T0);
    expect(shouldRevalidate("r", LIVE_REVISIT_MAX_AGE_MS, T0 + 5_000, URL_A)).toBe(true);
  });

  it("nova busca dentro de 5 min não troca a hora (o roteador reaproveita a 1ª)", () => {
    notePrefetch(URL_A, T0);
    notePrefetch(URL_A, T0 + 200_000);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 210_000, URL_A)).toBe(true);
  });

  it("depois de 5 min a busca é nova de verdade", () => {
    notePrefetch(URL_A, T0);
    notePrefetch(URL_A, T0 + 400_000);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 410_000, URL_A)).toBe(false);
  });

  it("refresh limpa o cache do roteador: a busca anotada some", () => {
    notePrefetch(URL_A, T0);
    notePrefetchCacheCleared();
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 240_000, URL_A)).toBe(false);
  });

  it("buscada antes de uma gravação fora do servidor: relê", () => {
    notePrefetch(URL_A, T0);
    markRouterCacheStale(T0 + 1_000);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 2_000, URL_A)).toBe(true);
  });

  it("outra URL não herda a busca", () => {
    notePrefetch(URL_A, T0);
    expect(shouldRevalidate("r", REVISIT_MAX_AGE_MS, T0 + 240_000, "/match/2")).toBe(false);
  });
});
