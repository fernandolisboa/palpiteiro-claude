/**
 * IP de origem + chave de bucket pro rate-limit pré-auth do magic link (#469).
 *
 * Módulo puro (sem `next/headers`) pra ser testável: a server action passa o
 * `Headers` e recebe a chave pronta.
 */

type HeaderReader = { get(name: string): string | null };

/**
 * IP do cliente a partir dos headers de proxy. Na Vercel o `x-forwarded-for` é
 * sobrescrito pela borda (o cliente não consegue injetar um valor próprio), e o
 * primeiro item da lista é o cliente. Sem header (dev/local sem proxy) → null.
 */
export function clientIp(h: HeaderReader): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return h.get("x-real-ip")?.trim() || null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(s: string): string | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets.join(".");
}

/** Expande um IPv6 textual em 8 hextets numéricos, ou null se inválido. */
function parseIpv6(s: string): number[] | null {
  let addr = s;
  // Sufixo IPv4 embutido (`::ffff:1.2.3.4`) → dois hextets.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const [a, b, c, d] = v4.split(".").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Chave do bucket por origem: IPv4 → o endereço; IPv6 → o prefixo /64.
 *
 * Por que /64: um único host/VPS costuma receber um /64 roteado inteiro, ou seja
 * 2^64 endereços distintos. Chavear pelo endereço completo deixaria um script
 * trocar de IP a cada request e contornar o teto por-IP. /64 é a menor sub-rede
 * que a IETF atribui a um link (RFC 4291 §2.5.1), então usuários distintos
 * raramente dividem o mesmo bucket. IPv4-mapped (`::ffff:a.b.c.d`) cai no bucket
 * IPv4 do endereço embutido.
 *
 * Entrada inválida → null (o caller pula o teto por-IP; o teto global segue valendo).
 */
export function ipBucketKey(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  // `[v6]:porta` / `[v6]` e `v4:porta`.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed?.[1]) s = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(s)) s = s.slice(0, s.indexOf(":"));

  const v4 = parseIpv4(s);
  if (v4) return v4;
  if (!s.includes(":")) return null;

  // Zone id (`fe80::1%eth0`) não identifica origem na internet.
  const groups = parseIpv6(s.split("%")[0] ?? "");
  if (!groups) return null;

  const isV4Mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isV4Mapped) {
    const g6 = groups[6] ?? 0;
    const g7 = groups[7] ?? 0;
    return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
  }

  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
