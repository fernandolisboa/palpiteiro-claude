import { describe, expect, it } from "vitest";

import { clientIp, ipBucketKey } from "@/lib/auth/client-ip";

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name] ?? null };
}

describe("clientIp", () => {
  it("usa o primeiro item do x-forwarded-for", () => {
    expect(
      clientIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))
    ).toBe("203.0.113.7");
  });

  it("cai no x-real-ip sem x-forwarded-for", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.2" }))).toBe(
      "198.51.100.2"
    );
  });

  it("null sem headers de proxy (dev)", () => {
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": " , " }))).toBeNull();
  });
});

describe("ipBucketKey", () => {
  it("IPv4 → o próprio endereço (normalizado)", () => {
    expect(ipBucketKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketKey(" 203.000.113.07 ")).toBe("203.0.113.7");
    expect(ipBucketKey("203.0.113.7:4431")).toBe("203.0.113.7");
  });

  it("IPv6 → prefixo /64: endereços do mesmo /64 caem no MESMO bucket", () => {
    const a = ipBucketKey("2001:db8:abcd:12::1");
    const b = ipBucketKey("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff");
    const c = ipBucketKey("2001:DB8:ABCD:12:dead:beef:0:1");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("IPv6 de /64 diferentes caem em buckets diferentes", () => {
    expect(ipBucketKey("2001:db8:abcd:13::1")).not.toBe(
      ipBucketKey("2001:db8:abcd:12::1")
    );
  });

  it("aceita colchetes, porta e zone id", () => {
    expect(ipBucketKey("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(ipBucketKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipBucketKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("formas comprimidas nas pontas", () => {
    expect(ipBucketKey("::1")).toBe("0:0:0:0::/64");
    expect(ipBucketKey("2001:db8::")).toBe("2001:db8:0:0::/64");
  });

  it("IPv4-mapped cai no bucket IPv4 do endereço embutido", () => {
    expect(ipBucketKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketKey("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("entrada inválida → null", () => {
    for (const bad of [
      "",
      "unknown",
      "999.1.1.1",
      "1.2.3",
      "2001:db8::1::2",
      "2001:db8:1:2:3:4:5:6:7",
      "2001:db8:1:2:3:4:5",
      "gggg::1",
      "12345::1",
      "::ffff:999.0.0.1",
    ]) {
      expect(ipBucketKey(bad), bad).toBeNull();
    }
  });
});
