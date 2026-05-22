import { FormDot } from "@/components/form-dot";
import type { FormView } from "@/lib/view/types";

type Props = {
  view: FormView;
};

export function FormSection({ view }: Props) {
  const hasData =
    view.home.results.length > 0 || view.away.results.length > 0;
  if (!hasData) {
    return (
      <div className="text-[12px] text-muted-foreground tracking-tight">
        Sem jogos recentes disponíveis.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3.5">
      {[view.home, view.away].map((r) => (
        <div key={r.name} className="flex items-center justify-between">
          <span className="text-[12.5px] text-foreground tracking-tight">
            {r.name}
          </span>
          <div className="flex items-center gap-1.5">
            {r.results.length === 0 ? (
              <span className="font-mono text-[10.5px] text-muted-fg-2">
                sem histórico
              </span>
            ) : (
              r.results.map((res, i) => <FormDot key={i} r={res} />)
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1 font-mono text-[10.5px] text-muted-foreground">
        <span>últimos 5 jogos</span>
        <span className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1">
            <FormDot r="W" />V
          </span>
          <span className="inline-flex items-center gap-1">
            <FormDot r="D" />E
          </span>
          <span className="inline-flex items-center gap-1">
            <FormDot r="L" />D
          </span>
        </span>
      </div>
    </div>
  );
}
