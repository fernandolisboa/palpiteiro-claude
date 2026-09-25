"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LEGAL_CONTACT_EMAIL } from "@/lib/legal/controller";

/**
 * Footer legal global (docs/ops/05-legal-compliance.md §7): selo 18+, jogo responsável,
 * CVV 188, links legais (Termos/Privacidade/Contato), disclaimer "não é casa de apostas".
 * Renderizado do root layout → herdado por TODA rota (landing, /signin, autenticadas,
 * /termos, /privacidade), inclusive as superfícies de maior intenção de aposta.
 *
 * EXCEÇÃO: o segmento público `/p/[id]` (snapshot compartilhável, ADR 0035) é
 * deliberadamente mínimo e já carrega seu próprio disclaimer — o footer se auto-oculta
 * lá pra não poluir o card que circula no zap nem introduzir chrome de navegação no
 * snapshot guardado. Client-only pelo `usePathname`; o conteúdo é estático e sai no HTML
 * do SSR nas demais rotas.
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/p" || pathname?.startsWith("/p/")) return null;

  const linkClass =
    "rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <footer className="border-t border-border-subtle px-6 py-8 text-muted-fg-2">
      <div className="mx-auto flex w-full max-w-content flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta tracking-tight">
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-eyebrow-xs uppercase tracking-eyebrow">
            18+
          </span>
          <span>Aposte com responsabilidade. Aposta não é investimento.</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-body-sm tracking-tight">
          <Link href="/termos" className={linkClass}>
            Termos
          </Link>
          <Link href="/privacidade" className={linkClass}>
            Privacidade
          </Link>
          <Link href="/como-funciona" className={linkClass}>
            Como funciona
          </Link>
          {/* Canal do titular (LGPD art. 9º, IV; Res. CD/ANPD 2/2022 art. 11) a um clique
              de qualquer página — report 11. */}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>
            Contato
          </a>
          <a
            href="https://www.cvv.org.br"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            CVV 188
          </a>
          <a
            href="https://jogadoresanonimos.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Jogadores Anônimos
          </a>
        </nav>

        <p className="max-w-reading text-meta leading-relaxed tracking-tight">
          Palpiteiro é uma ferramenta de análise. Não é casa de apostas e não aceita
          dinheiro real.
        </p>
      </div>
    </footer>
  );
}
