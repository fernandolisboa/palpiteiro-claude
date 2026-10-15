import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Back = { href: string; label: string };

const TITLE = "text-display-md font-medium leading-none tracking-tight lg:text-display-lg";

/**
 * Cabeçalho único das telas logadas de usuário (ADR 0056): volta opcional, h1,
 * descrição (sans) e meta (sans, números alinhados). `actions` fica à direita no
 * desktop e embaixo no celular. O admin usa `components/admin/page-heading.tsx`.
 */
export function PageHeader({
  title,
  description,
  meta,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  back?: Back;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 pb-6 lg:flex-row lg:items-end lg:justify-between lg:pb-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        {back && <BackLink href={back.href} label={back.label} />}
        <h1 className={TITLE}>{title}</h1>
        {description && (
          <div className="pt-2 text-body tracking-tight text-muted-foreground">
            {description}
          </div>
        )}
        {meta && <div className="pt-1 text-meta tabular-nums text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex flex-col gap-2 lg:items-end">{actions}</div>}
    </header>
  );
}

/**
 * Esqueleto do `PageHeader` pros `loading.tsx`, com as mesmas alturas (anti-CLS,
 * ADR 0029). Com `title` o h1 sai de verdade (título fixo da rota).
 */
export function PageHeaderSkeleton({
  title,
  description = false,
  meta = false,
  back = false,
  actions,
  className,
}: {
  title?: string;
  description?: boolean;
  meta?: boolean;
  back?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 lg:flex-row lg:items-end lg:justify-between lg:pb-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        {back && <Skeleton className="mb-6 h-[18px] w-16" />}
        {title ? (
          <h1 className={TITLE}>{title}</h1>
        ) : (
          <Skeleton className="h-[26px] w-48 lg:h-8" />
        )}
        {description && (
          <div className="pt-2">
            <Skeleton className="h-5 w-72 max-w-full" />
          </div>
        )}
        {meta && (
          <div className="pt-1">
            <Skeleton className="h-4 w-40" />
          </div>
        )}
      </div>
      {actions && <div className="flex flex-col gap-2 lg:items-end">{actions}</div>}
    </div>
  );
}
