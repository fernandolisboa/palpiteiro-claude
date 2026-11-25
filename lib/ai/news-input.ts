import { truncate } from "@/lib/ai/ai-call-logging";
import { containsNewsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { NewsResult } from "@/lib/providers/news/types";

// Saneamento de notícia na ENTRADA de um LLM (#670, extraído no #672). Título e trecho
// vêm de fora (feed do ge ou web search) e são não-confiáveis: uma linha só, sem os
// delimitadores das seções de notícia, frase com linguagem de valor fora, URL só https.
// Usado pela síntese dos palpites (v13/v14) e pelo extrator das notícias do jogo
// (match_news_extract): as duas pontas veem o MESMO texto saneado.

// Teto do trecho que chega ao prompt (o feed já corta em 280; a web search não).
export const NEWS_SNIPPET_MAX = 400;
// Teto de itens de notícia num prompt.
export const NEWS_ITEMS_MAX = 10;

export type SanitizedNewsItem = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  source?: NonNullable<NewsResult["source"]>;
};

// Uma linha só, sem os delimitadores da seção de notícias (`<<<`/`>>>` viram um sinal só).
export function neutralizeExternal(s: string): string {
  return s.replace(/\s+/g, " ").replace(/<{2,}/g, "<").replace(/>{2,}/g, ">").trim();
}

// URL externa só https, revalidada pelo parser de URL e emitida normalizada (`href`
// codifica `<`, `>` e espaço: um link não fecha os delimitadores da seção).
export function safeHttpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname !== "" ? u.href : null;
  } catch {
    return null;
  }
}

// Tira do trecho só as frases com linguagem de valor (o resto da matéria segue).
export function cleanSnippet(snippet: string): string | null {
  const kept = snippet
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !containsNewsValueLanguage(sentence))
    .join(" ")
    .trim();
  return kept === "" ? null : truncate(kept, NEWS_SNIPPET_MAX);
}

/**
 * Prepara as notícias pro prompt: título/trecho achatados e neutralizados, URL só https
 * (normalizada), frase do trecho com linguagem de valor fora (o resto do trecho fica) e
 * item cujo título tem linguagem de valor fora. A régua da notícia
 * (containsNewsValueLanguage) deixa passar "retorno" e "R$"; o firewall de SAÍDA de cada
 * consumidor continua a rede final. Teto de NEWS_ITEMS_MAX itens.
 */
export function sanitizeNews(news: readonly NewsResult[]): SanitizedNewsItem[] {
  const out: SanitizedNewsItem[] = [];
  for (const n of news) {
    const title = neutralizeExternal(n.title);
    const url = safeHttpsUrl(n.url);
    if (title === "" || url === null) continue;
    if (containsNewsValueLanguage(title)) continue;
    const snippetRaw = n.snippet ? neutralizeExternal(n.snippet) : "";
    const snippet = snippetRaw === "" ? null : cleanSnippet(snippetRaw);
    out.push({
      title,
      url,
      ...(snippet ? { snippet } : {}),
      ...(n.publishedAt ? { publishedAt: n.publishedAt } : {}),
      ...(n.source ? { source: n.source } : {}),
    });
    if (out.length >= NEWS_ITEMS_MAX) break;
  }
  return out;
}

// Data da notícia no fuso de Brasília ("21/11 15:43"), como a imprensa BR mostra.
const NEWS_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "21/11 15:43" (America/Sao_Paulo); null pra data ausente ou inválida. */
export function newsDateLabel(iso: string | undefined): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return NEWS_DATE_FORMAT.format(new Date(ms)).replace(",", "");
}
