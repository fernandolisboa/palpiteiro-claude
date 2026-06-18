import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  action?: ReactNode;
};

export function SectionLabel({ children, action }: Props) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-1 pb-2">
      <span className="font-mono text-eyebrow tracking-eyebrow text-muted-foreground uppercase">
        {children}
      </span>
      {action}
    </div>
  );
}
