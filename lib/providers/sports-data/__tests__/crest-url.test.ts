import { describe, expect, it } from "vitest";

import { safeCrestUrl } from "@/lib/providers/sports-data/crest-url";

describe("safeCrestUrl (#578)", () => {
  it.each([
    "https://media.api-sports.io/football/teams/121.png",
    "https://media-4.api-sports.io/football/teams/121.png",
    "https://crests.football-data.org/1769.png",
    "https://crests.football-data.org/1769.svg",
  ])("aceita %s", (url) => {
    expect(safeCrestUrl(url)).toBe(url);
  });

  it("devolve a URL normalizada (url.href)", () => {
    expect(safeCrestUrl("https://MEDIA.api-sports.io/football/teams/121.png")).toBe(
      "https://media.api-sports.io/football/teams/121.png",
    );
  });

  it.each([
    "http://media.api-sports.io/football/teams/121.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://evil.api-sports.io.example.com/football/teams/121.png",
    "https://v3.football.api-sports.io/football/teams/121.png",
    "https://api-sports.io/football/teams/121.png",
    "https://x.media.api-sports.io/football/teams/121.png",
    "https://x@media.api-sports.io/football/teams/121.png",
    "https://x:y@media.api-sports.io/football/teams/121.png",
    "https://media.api-sports.io:8443/football/teams/121.png",
    "https://media.api-sports.io/football/leagues/71.png",
    "https://media.api-sports.io/football/bookmakers/8.png",
    "https://media.api-sports.io/football/teams/121.svg",
    "https://media.api-sports.io/football/teams/121.png?x=1",
    "https://media.api-sports.io/football/teams/121.png?",
    "https://media.api-sports.io/football/teams/121.png#a",
    "https://crests.football-data.org/a/b.png",
    "https://crests.football-data.org/1769.gif",
    `https://crests.football-data.org/${"a".repeat(300)}.png`,
    "",
    "not a url",
  ])("recusa %j", (url) => {
    expect(safeCrestUrl(url)).toBeUndefined();
  });

  it("recusa null e undefined", () => {
    expect(safeCrestUrl(null)).toBeUndefined();
    expect(safeCrestUrl(undefined)).toBeUndefined();
  });
});
