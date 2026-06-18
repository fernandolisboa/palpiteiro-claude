import type { LeagueKey } from "@/lib/view/types";

// Canonical EN (nome da seleção) → código de bandeira, pras 48 seleções de
// world_cup. Em geral ISO 3166-1 alpha-2; Inglaterra/Escócia usam os códigos de
// SUBDIVISÃO do circle-flags (gb-eng/gb-sct), que não são países ISO.
//
// O código é só pra resolver o asset vendorizado em public/flags/wc/<code>.svg
// (circle-flags, MIT). NUNCA é chave de matching — display-only, gateado por liga
// (só 'wc'). Um teste garante que todo canonical de world_cup tem código e que
// todo código tem SVG vendorizado.
const WC_FLAG_CODE: Record<string, string> = {
  Algeria: "dz",
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  "Bosnia & Herzegovina": "ba",
  Brazil: "br",
  Canada: "ca",
  "Cape Verde Islands": "cv",
  Colombia: "co",
  "Congo DR": "cd",
  Croatia: "hr",
  Curaçao: "cw",
  "Czech Republic": "cz",
  Ecuador: "ec",
  Egypt: "eg",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  Iran: "ir",
  Iraq: "iq",
  "Ivory Coast": "ci",
  Japan: "jp",
  Jordan: "jo",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Norway: "no",
  Panama: "pa",
  Paraguay: "py",
  Portugal: "pt",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  "South Africa": "za",
  "South Korea": "kr",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tunisia: "tn",
  Türkiye: "tr",
  USA: "us",
  Uruguay: "uy",
  Uzbekistan: "uz",
};

/**
 * Código de bandeira de um time, ou `undefined`. Só retorna código para
 * `world_cup` ('wc'); clubes (qualquer outra liga) não têm bandeira nesta fase.
 * Display-only — nunca usar como chave de matching.
 */
export function flagCodeForTeam(
  canonicalName: string,
  league: LeagueKey,
): string | undefined {
  if (league !== "wc") return undefined;
  return WC_FLAG_CODE[canonicalName];
}

// Exportado só pros testes de completude (todo canonical mapeado; todo código
// com SVG vendorizado).
export { WC_FLAG_CODE };
