"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleProps = {
  icon?: ReactNode;
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Collapsible({
  icon,
  title,
  meta,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="s-coll" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="s-coll__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {icon}
        <span className="s-coll__title">{title}</span>
        {meta && <span className="s-coll__meta">{meta}</span>}
        <span className="s-coll__chev">
          <ChevronDown size={16} />
        </span>
      </button>
      {open && <div className="s-coll__body">{children}</div>}
    </section>
  );
}
