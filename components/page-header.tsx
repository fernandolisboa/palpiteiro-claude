import { ThemeToggle } from "@/components/theme-toggle";

type Props = {
  subtitle?: string;
};

export function PageHeader({ subtitle }: Props) {
  return (
    <header className="px-5 pt-6 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className="font-semibold tracking-tight"
            style={{ fontSize: 18, letterSpacing: "-0.04em" }}
          >
            palpiteiro
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--muted-fg-2)" }}
          >
            ·&nbsp;v0
          </span>
        </div>
        <div className="flex items-center gap-2">
          {subtitle && (
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {subtitle}
            </span>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
