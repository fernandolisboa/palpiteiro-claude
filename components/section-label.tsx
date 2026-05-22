import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  action?: ReactNode;
};

export function SectionLabel({ children, action }: Props) {
  return (
    <div className="flex items-baseline justify-between px-5 pb-2 pt-1">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </span>
      {action}
    </div>
  );
}
