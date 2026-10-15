// Escudo de time (#578): aceita só URL https de escudo de TIME nos CDNs dos providers
// de dados esportivos. O caminho é restrito a times, o que garante que nunca entra
// logo de liga, de casa de apostas ou outro asset do fornecedor. Qualquer outra coisa
// vira undefined (a UI cai nas iniciais). Só exibição: nunca entra em chave nem prompt.

const MAX_LENGTH = 300;
// media.api-sports.io e os media-N que a API-Football alterna. Exato: "qualquer
// subdomínio de api-sports.io" incluiria o host da própria API.
const API_SPORTS_HOST = /^media(-\d+)?\.api-sports\.io$/;
const API_SPORTS_PATH = /^\/football\/teams\/\d+\.png$/;
const FOOTBALL_DATA_HOST = "crests.football-data.org";
// SVG em <img> não executa script, então o .svg do football-data.org é seguro.
const FOOTBALL_DATA_PATH = /^\/[A-Za-z0-9_-]+\.(png|svg)$/;

export function safeCrestUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.username || url.password || url.port || url.search || url.hash) {
    return undefined;
  }
  // `new URL` normaliza "?"/"#" vazios para search/hash vazios; a string crua
  // também não pode trazê-los.
  if (raw.includes("?") || raw.includes("#")) return undefined;
  const okApiSports =
    API_SPORTS_HOST.test(url.hostname) && API_SPORTS_PATH.test(url.pathname);
  const okFootballData =
    url.hostname === FOOTBALL_DATA_HOST && FOOTBALL_DATA_PATH.test(url.pathname);
  return okApiSports || okFootballData ? url.href : undefined;
}
