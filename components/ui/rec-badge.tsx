import type { Recommendation } from "@/lib/mock-data";

type RecBadgeProps = {
  rec: Recommendation;
  size?: "sm" | "md" | "lg" | "xl";
};

export function RecBadge({ rec, size = "md" }: RecBadgeProps) {
  const lead = rec === "over" ? "↑" : rec === "under" ? "↓" : "—";
  const label = rec === "pass" ? "pass" : rec === "over" ? "over 2.5" : "under 2.5";
  const classes = ["s-rec", `s-rec--${rec}`, `s-rec--${size}`];
  return (
    <span className={classes.join(" ")}>
      <span className="s-rec__lead">{lead}</span>
      <span>{label}</span>
    </span>
  );
}
