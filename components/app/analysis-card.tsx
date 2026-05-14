import Link from "next/link";
import { CircleSlash, RefreshCw, Sparkles } from "lucide-react";
import { RecBadge } from "@/components/ui/rec-badge";
import { fmt } from "@/lib/format";
import type { Analysis } from "@/lib/mock-data";

type AnalysisCardProps = {
  analysis: Analysis;
  reanalyzeHref?: string;
};

export function AnalysisCard({ analysis, reanalyzeHref }: AnalysisCardProps) {
  const { rec, confidence, edge, minimumOdd, rationale, factors, meta } = analysis;
  const isPass = rec === "pass";
  return (
    <div className="s-analysis-wrap">
      {isPass && (
        <header className="s-pass-header">
          <div className="s-pass-header__title">
            <CircleSlash size={14} />
            <span>Sem edge claro</span>
          </div>
          <div className="s-pass-header__desc">
            A IA passa a vez quando a confiança estimada está a menos de 5 pp da
            probabilidade implícita do mercado. É resultado esperado — não
            fracasso.
          </div>
        </header>
      )}
      <article className={`s-analysis s-analysis--${rec}`}>
        <header className="s-analysis__head">
          <div className="s-analysis__eyebrow">
            <Sparkles size={14} />
            <span className="s-eyebrow">análise da ia</span>
          </div>
        </header>

        {isPass ? (
          <>
            <div className="s-analysis__main">
              <RecBadge rec="pass" size="xl" />
            </div>
            <div className="s-analysis__pass-compare">
              <span>
                <span className="s-analysis__pass-compare-k">est. over</span>
                <span className="s-analysis__pass-compare-v">
                  {fmt.conf(confidence)}
                </span>
              </span>
              <span className="s-analysis__pass-arrow">·</span>
              <span>
                <span className="s-analysis__pass-compare-k">implícita</span>
                <span className="s-analysis__pass-compare-v">
                  {fmt.conf(confidence - edge)}
                </span>
              </span>
              <span className="s-analysis__pass-arrow">·</span>
              <span>
                <span className="s-analysis__pass-compare-k">edge</span>
                <span className="s-analysis__pass-compare-v">{fmt.pp(edge)}</span>
              </span>
              <span className="s-analysis__pass-arrow">·</span>
              <span>
                <span className="s-analysis__pass-compare-k">floor</span>
                <span className="s-analysis__pass-compare-v">+5,0 pp</span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="s-analysis__main">
              <RecBadge rec={rec} size="xl" />
              <div className="s-analysis__min-odd">
                Vale a aposta se a odd for{" "}
                <strong>≥ {fmt.odd(minimumOdd)}</strong>.
                <br />
                Captado em {meta.bookmaker}.
              </div>
            </div>
            <div className="s-analysis__stats">
              <div className="s-analysis__stat">
                <div className="s-analysis__stat-l">confiança</div>
                <div className="s-analysis__stat-v">{fmt.conf(confidence)}</div>
              </div>
              <div className="s-analysis__stat">
                <div className="s-analysis__stat-l">edge</div>
                <div className="s-analysis__stat-v s-analysis__stat-v--accent">
                  {fmt.pp(edge)}
                </div>
              </div>
              <div className="s-analysis__stat">
                <div className="s-analysis__stat-l">odd mín.</div>
                <div className="s-analysis__stat-v">{fmt.odd(minimumOdd)}</div>
              </div>
            </div>
          </>
        )}

        <blockquote className="s-analysis__rationale">{rationale}</blockquote>

        <div>
          <div className="s-analysis__factors-h">fatores-chave</div>
          <ul className="s-analysis__factors">
            {factors.map((f, i) => (
              <li key={i} className="s-analysis__factor">
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="s-analysis__foot">
          <span className="s-analysis__meta-strip">
            <span>{meta.prompt}</span>
            <span className="s-analysis__meta-dot">·</span>
            <span>{meta.model}</span>
            <span className="s-analysis__meta-dot">·</span>
            <span>US$ {meta.cost.toFixed(4)}</span>
            <span className="s-analysis__meta-dot">·</span>
            <span>{meta.timestamp}</span>
          </span>
          {reanalyzeHref && (
            <Link className="s-reanalyze" href={reanalyzeHref}>
              <RefreshCw size={12} />
              <span>Analisar novamente</span>
            </Link>
          )}
        </footer>
      </article>
    </div>
  );
}
