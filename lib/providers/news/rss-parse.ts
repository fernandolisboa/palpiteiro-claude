// Parser de RSS 2.0 ESTREITO e puro (ADR 0032, adendo #670). Sem dependência nova: a
// entrada é só `<item>` com title/link/pubDate/description (ou content:encoded) e a
// linha fina `<atom:subtitle>` do ge. Regex não-gulosa sobre uma entrada limitada a
// MAX_FEED_CHARS; nada aqui faz rede nem lança. Lixo vira item descartado, nunca erro.

// Teto da entrada (o fetch corta o corpo em 2 MB; aqui é a rede de segurança do parser).
export const MAX_FEED_CHARS = 2 * 1024 * 1024;
export const SNIPPET_MAX = 280;

export type RssItem = {
  title: string;
  link: string;
  // null = pubDate ausente ou inválida (o filtro de janela descarta).
  pubDate: Date | null;
  // Linha fina do ge (`atom:subtitle`), já em texto puro.
  subtitle: string | null;
  // Corpo em texto puro, sem boilerplate, espaços achatados.
  text: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
};

function codePoint(n: number): string {
  // Fora do Unicode válido (ou surrogate solto) vira nada, nunca lança.
  if (
    !Number.isInteger(n) ||
    n <= 0 ||
    n > 0x10ffff ||
    (n >= 0xd800 && n <= 0xdfff)
  ) {
    return "";
  }
  return String.fromCodePoint(n);
}

export function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi,
    (whole, ent: string) => {
      if (ent[0] === "#") {
        const hex = ent[1] === "x" || ent[1] === "X";
        return codePoint(
          Number.parseInt(ent.slice(hex ? 2 : 1), hex ? 16 : 10)
        );
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
    }
  );
}

// Achata espaços (inclusive quebras de linha) num espaço só.
export function flattenWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripTags(s: string): string {
  return s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
}

// HTML (ou HTML escapado, como no description do WordPress) → texto. Mantém as quebras
// de linha pra o filtro de boilerplate; quem precisa de uma linha só achata depois.
export function htmlToText(s: string): string {
  const once = decodeEntities(stripTags(unwrapCdata(s)));
  // HTML escapado (`&lt;p&gt;…&amp;amp;…`): a 1ª decodificação revela as tags e as
  // entidades do HTML de dentro; tira as tags e decodifica de novo. Texto comum passa
  // uma vez só (um "&amp;lt;" literal não vira "<").
  const text = /<\/?[a-z][^>]*>/i.test(once)
    ? decodeEntities(stripTags(once))
    : once;
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

// Linhas de rodapé do ge que não são a matéria ("+ Leia mais notícias…", "🎧 Ouça o
// podcast…", "Assista: tudo sobre…", resto de embed).
const BOILERPLATE_LINE =
  /^(?:\+\s|.*\bleia mais\b|.*\bou[çc]a o podcast\b|assista:|initial plugin text$|veja tamb[ée]m:?$)/i;

function cleanBody(text: string): string {
  return flattenWhitespace(
    text
      .split("\n")
      .filter((line) => !BOILERPLATE_LINE.test(line.trim()))
      .join(" ")
  );
}

function tagContent(item: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(item);
  return m ? m[1] : null;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const ms = Date.parse(flattenWhitespace(decodeEntities(unwrapCdata(raw))));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// `true` se o corpo tem cara de RSS (um 200 com página HTML de erro não é feed).
export function looksLikeRssFeed(xml: string): boolean {
  const head = xml.slice(0, MAX_FEED_CHARS);
  return /<rss[\s>]/i.test(head) && /<channel[\s>]/i.test(head);
}

/**
 * Os `<item>` de um RSS 2.0, na ordem do feed. Item sem título ou sem link é
 * descartado; data inválida vira `pubDate: null`. Nunca lança.
 */
export function parseRssItems(xml: string): RssItem[] {
  const input =
    xml.length > MAX_FEED_CHARS ? xml.slice(0, MAX_FEED_CHARS) : xml;
  const out: RssItem[] = [];
  for (const m of input.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const title = flattenWhitespace(
      htmlToText(tagContent(body, "title") ?? "")
    );
    const link = flattenWhitespace(
      decodeEntities(unwrapCdata(tagContent(body, "link") ?? ""))
    );
    if (title === "" || link === "") continue;
    const subtitleRaw = tagContent(body, "atom:subtitle");
    const subtitle =
      subtitleRaw === null ? null : flattenWhitespace(htmlToText(subtitleRaw));
    const bodyRaw =
      tagContent(body, "content:encoded") ??
      tagContent(body, "description") ??
      "";
    out.push({
      title,
      link,
      pubDate: parseDate(tagContent(body, "pubDate")),
      subtitle: subtitle === "" ? null : subtitle,
      text: cleanBody(htmlToText(bodyRaw)),
    });
  }
  return out;
}

// Corta em fim de palavra, com reticências, no máximo `max` chars (já contando a "…").
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/**
 * Trecho curto pro prompt: a linha fina (resumo editorial do ge) ou, sem ela, o começo
 * do texto. ≤ SNIPPET_MAX chars, cortado em palavra. Vazio → null.
 */
export function makeSnippet(
  item: Pick<RssItem, "subtitle" | "text">,
  max = SNIPPET_MAX
): string | null {
  const base = flattenWhitespace(item.subtitle ?? item.text);
  return base === "" ? null : cutAtWord(base, max);
}
