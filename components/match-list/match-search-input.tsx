"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { normalizeQuery } from "@/lib/view/match-search";
import { buildFiltersHref, type RangeNavState } from "@/lib/view/range-href";

// Espera depois da última tecla antes de buscar: a busca roda no servidor (#643).
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Busca da lista de jogos (#643): time, competição ou data num campo só. Busca
 * enquanto digita (com espera) e no Enter, trocando o `q` da URL com `replace` (sem
 * encher o histórico); a liga, as datas e os outros filtros ficam como estão.
 *
 * A página monta duas cópias (celular e desktop, uma escondida por CSS). Cada uma tem
 * o próprio texto; a que não está em foco acompanha a URL (limpar filtros, voltar).
 */
export function MatchSearchInput({
  nav,
  className,
}: {
  nav: RangeNavState;
  className?: string;
}) {
  const router = useRouter();
  const urlValue = nav.filters?.q ?? "";
  const [text, setText] = useState(urlValue);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // O último `q` mandado pra URL (ou vindo dela): não repete a navegação.
  const lastSent = useRef(urlValue);
  // O estado de navegação mais recente pro timer, que dispara depois do render.
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  // Texto digitado antes da hidratação fica só no DOM (o onChange ainda não existia):
  // na montagem, o estado assume o que está no campo e a busca segue normal.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed !== urlValue) setText(typed);
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A URL mudou (busca que voltou do servidor, voltar do navegador, limpar filtros,
  // a outra cópia): o campo acompanha, a não ser que haja texto ainda não mandado.
  // Com foco ou sem: o voltar do navegador não tira o foco do campo.
  useEffect(() => {
    const sent = lastSent.current;
    lastSent.current = urlValue;
    setText((current) => {
      const typed = normalizeQuery(current) ?? "";
      return typed === sent && typed !== urlValue ? urlValue : current;
    });
  }, [urlValue]);

  function submit(raw: string) {
    const next = normalizeQuery(raw) ?? "";
    if (next === lastSent.current) return;
    lastSent.current = next;
    const href = buildFiltersHref(navRef.current, { q: next || undefined });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  useEffect(() => {
    if ((normalizeQuery(text) ?? "") === lastSent.current) return;
    const id = setTimeout(() => submit(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // `submit` lê só refs e o router; o timer reinicia a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
    >
      <Search
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground",
          pending && "animate-pulse",
        )}
      />
      <input
        ref={inputRef}
        type="search"
        aria-label="Buscar jogos"
        aria-busy={pending || undefined}
        placeholder="Buscar time, competição ou data"
        title="Ex.: flamengo, champions, sábado, 25/10"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={80}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text !== "") {
            e.preventDefault();
            setText("");
            submit("");
          }
        }}
        // 16px no celular: abaixo disso o Safari do iPhone dá zoom ao focar o campo.
        className="h-9 w-full rounded-full border border-input bg-transparent pr-9 pl-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-body-sm [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text !== "" && (
        <button
          type="button"
          aria-label="Limpar busca"
          title="Limpar busca"
          onClick={() => {
            setText("");
            submit("");
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </form>
  );
}
