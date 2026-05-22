import { FormDot } from "@/components/form-dot";

type Result = "W" | "D" | "L";
type Row = { name: string; results: Result[] };

type Props = {
  home: string;
  away: string;
  rows?: Row[];
};

const DEFAULT_ROWS: Row[] = [
  { name: "home", results: ["W", "W", "D", "L", "W"] },
  { name: "away", results: ["L", "W", "W", "W", "D"] },
];

export function FormSection({ home, away, rows }: Props) {
  const resolved = rows ?? [
    { name: home, results: DEFAULT_ROWS[0].results },
    { name: away, results: DEFAULT_ROWS[1].results },
  ];
  return (
    <div className="flex flex-col gap-3.5">
      {resolved.map((r) => (
        <div key={r.name} className="flex items-center justify-between">
          <span className="text-[12.5px] text-foreground tracking-tight">{r.name}</span>
          <div className="flex items-center gap-1.5">
            {r.results.map((res, i) => (
              <FormDot key={i} r={res} />
            ))}
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
