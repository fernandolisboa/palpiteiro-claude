import { type CSSProperties } from "react";

type AvatarProps = {
  short: string;
  color?: string;
  size?: "md" | "lg" | "xl";
};

export function Avatar({ short, color, size = "md" }: AvatarProps) {
  const classes = ["s-avatar"];
  if (size === "lg") classes.push("s-avatar--lg");
  if (size === "xl") classes.push("s-avatar--xl");
  const style = {
    "--avatar-accent": color ?? "var(--border-2)",
  } as CSSProperties;
  return (
    <span className={classes.join(" ")} style={style}>
      {short}
    </span>
  );
}
