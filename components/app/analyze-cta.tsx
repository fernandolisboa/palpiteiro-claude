import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

type AnalyzeCTAProps = {
  analyzeHref: string;
};

export function AnalyzeCTA({ analyzeHref }: AnalyzeCTAProps) {
  return (
    <section className="s-analyze-cta">
      <Sparkles size={22} />
      <div className="s-analyze-cta__copy">
        <div className="s-analyze-cta__t">Pronto pra análise</div>
        <div className="s-analyze-cta__d">
          A IA recomenda apenas com edge ≥ 5%. Pode passar a vez.
        </div>
      </div>
      <div className="s-analyze-cta__btn">
        <Link href={analyzeHref} className="s-btn s-btn--primary">
          <span>Analisar com IA</span>
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
