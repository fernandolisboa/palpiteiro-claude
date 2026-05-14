import { type ReactNode } from "react";

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={["s-eyebrow", className].filter(Boolean).join(" ")}>{children}</div>;
}
