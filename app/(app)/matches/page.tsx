import Link from "next/link";
import { CalendarX2, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { AppBar } from "@/components/app/app-bar";
import { MatchItem, MatchItemSkeleton } from "@/components/app/match-item";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { fmt } from "@/lib/format";
import { matches, sidebarStats } from "@/lib/mock-data";

type SearchParams = Promise<{ filter?: string; state?: string }>;

const FILTERS = [
  { id: "all", label: "todos" },
  { id: "bsa", label: "brasileirão" },
  { id: "ucl", label: "champions" },
] as const;

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const filter = params.filter ?? "all";
  const state = params.state ?? "default";

  const filtered =
    filter === "bsa"
      ? matches.filter((m) => m.league === "BSA")
      : filter === "ucl"
        ? matches.filter((m) => m.league === "UCL")
        : matches;

  return (
    <>
      <AppBar />
      <main className="s-body">
        <header className="s-page-h">
          <Eyebrow>próximas 48h</Eyebrow>
          <h1 className="s-page-h__title">Jogos</h1>
        </header>

        <div className="s-tabs">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={f.id === "all" ? "/matches" : `/matches?filter=${f.id}`}
              className={filter === f.id ? "is-on" : ""}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="s-matches-grid">
          <div className="s-list">
            {state === "loading" && (
              <>
                <MatchItemSkeleton />
                <MatchItemSkeleton />
                <MatchItemSkeleton />
                <MatchItemSkeleton />
              </>
            )}
            {state === "empty" && (
              <div className="s-state">
                <span className="s-state__icon">
                  <CalendarX2 size={20} />
                </span>
                <div>
                  <div className="s-state__title">Sem jogos nas próximas 48h</div>
                  <div className="s-state__desc">
                    Volte aqui em algumas horas — os jogos do dia aparecem assim
                    que o cron sincroniza com a API-Football.
                  </div>
                </div>
              </div>
            )}
            {state === "error" && (
              <div className="s-state s-state--error">
                <span className="s-state__icon">
                  <TriangleAlert size={20} />
                </span>
                <div>
                  <div className="s-state__title">
                    Não consegui carregar os jogos
                  </div>
                  <div className="s-state__desc">
                    Falha ao consultar API-Football. Pode ser quota diária ou
                    suspensão temporária da conta. Tente em alguns minutos.
                  </div>
                </div>
                <Button kind="secondary" size="sm" icon={RefreshCw}>
                  Tentar de novo
                </Button>
              </div>
            )}
            {state === "default" &&
              filtered.map((m) => <MatchItem key={m.id} match={m} />)}
          </div>

          <aside className="s-aside">
            <div className="s-aside-card">
              <div className="s-aside-card__h">Métricas · últimos 30d</div>
              <div className="s-aside-card__stat">
                <span>yield</span>
                <span
                  className="s-aside-card__stat-v--pos"
                  style={{ fontWeight: 500 }}
                >
                  {fmt.pct(sidebarStats.yield30d)}
                </span>
              </div>
              <div className="s-aside-card__stat">
                <span>win rate</span>
                <span>{sidebarStats.winRate}%</span>
              </div>
              <div className="s-aside-card__stat">
                <span>pass rate</span>
                <span>{sidebarStats.passRate}%</span>
              </div>
              <div className="s-aside-card__stat">
                <span>predições</span>
                <span>{sidebarStats.settled} settled</span>
              </div>
              <div className="s-aside-card__stat">
                <span>custo/análise</span>
                <span>US$ {sidebarStats.avgCost.toFixed(4)}</span>
              </div>
            </div>

            <div className="s-aside-card">
              <div className="s-aside-card__h">Filtros</div>
              <div className="s-aside-card__stat">
                <span>liga</span>
                <span style={{ color: "var(--fg-2)" }}>todas</span>
              </div>
              <div className="s-aside-card__stat">
                <span>status</span>
                <span style={{ color: "var(--fg-2)" }}>todos</span>
              </div>
              <div className="s-aside-card__stat">
                <span>edge mín</span>
                <span>5,0 pp</span>
              </div>
            </div>

            <div className="s-note">
              <Info size={13} />
              <span>
                Cron sincroniza jogos das próximas 72h às 06:00 UTC. Odds são
                consultadas sob demanda.
              </span>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
