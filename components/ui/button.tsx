import { type ComponentProps, type ReactNode } from "react";
import { type LucideIcon, Loader2 } from "lucide-react";

type ButtonKind = "primary" | "secondary" | "ghost" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  full?: boolean;
  loading?: boolean;
  children?: ReactNode;
} & Omit<ComponentProps<"button">, "children">;

export function Button({
  kind = "primary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  full,
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["s-btn", `s-btn--${kind}`];
  if (size === "sm") classes.push("s-btn--sm");
  if (size === "lg") classes.push("s-btn--lg");
  if (full) classes.push("s-btn--full");
  if (disabled || loading) classes.push("is-disabled");
  if (className) classes.push(className);

  const iconSize = size === "sm" ? 14 : 16;

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2
          size={iconSize}
          className="animate-spin"
          style={{ animation: "s-spin 0.75s linear infinite" }}
        />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}
      {children && <span>{children}</span>}
      {IconRight && <IconRight size={iconSize} />}
    </button>
  );
}
