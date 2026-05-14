import { Sparkles } from "lucide-react";

type ThinkingCardProps = {
  stage?: string;
};

export function ThinkingCard({
  stage = "Coletando dados estatísticos",
}: ThinkingCardProps) {
  return (
    <section className="s-thinking">
      <div className="s-thinking__head">
        <Sparkles size={13} />
        <span>análise da ia</span>
        <span className="s-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="s-thinking__lines">
        <span style={{ width: "92%" }} />
        <span style={{ width: "78%" }} />
        <span style={{ width: "86%" }} />
        <span style={{ width: "44%" }} />
      </div>
      <div className="s-thinking__progress">
        <span>{stage}…</span>
        <span>~12s</span>
      </div>
    </section>
  );
}
