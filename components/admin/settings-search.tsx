"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { searchSettings, type SettingEntry } from "@/lib/admin/settings-index";
import { cn } from "@/lib/utils";

// Quanto tempo esperar a página nova montar a âncora antes de desistir de destacar
// (cold start do Neon + as queries da calibração cabem com folga).
const REVEAL_TIMEOUT_MS = 10_000;
const REVEAL_POLL_MS = 100;
const HIGHLIGHT_MS = 2400;

const highlightTimers = new WeakMap<
  HTMLElement,
  ReturnType<typeof setTimeout>
>();

/**
 * Rola até o bloco da configuração e o contorna por um instante. A âncora pode estar
 * numa página que ainda está carregando: espera ela aparecer (ids são únicos por
 * página, então a página antiga nunca tem a da nova). Se ela não aparecer, volta ao
 * topo: a navegação foi sem o scroll do Next. O foco vai pro bloco, não pro botão
 * dentro dele: um Enter a mais não liga nem desliga nada.
 */
export function revealSetting(anchorId: string): void {
  const startedAt = Date.now();
  const attempt = () => {
    const el = document.getElementById(anchorId);
    if (!el) {
      if (Date.now() - startedAt < REVEAL_TIMEOUT_MS)
        setTimeout(attempt, REVEAL_POLL_MS);
      else window.scrollTo(0, 0);
      return;
    }
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
    // tabindex só enquanto o bloco tem o foco: senão um clique dentro dele focaria o
    // bloco inteiro depois.
    if (!el.hasAttribute("tabindex")) {
      el.setAttribute("tabindex", "-1");
      el.setAttribute("data-search-target", "");
      el.addEventListener(
        "blur",
        () => {
          el.removeAttribute("tabindex");
          el.removeAttribute("data-search-target");
        },
        { once: true }
      );
    }
    el.focus({ preventScroll: true });
    el.setAttribute("data-search-hit", "");
    clearTimeout(highlightTimers.get(el));
    highlightTimers.set(
      el,
      setTimeout(() => el.removeAttribute("data-search-hit"), HIGHLIGHT_MS)
    );
  };
  attempt();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Busca de configurações do admin: acha flags, ajustes e páginas pelo nome, sinônimo
 * ou descrição (sem acento) e leva direto ao bloco. "/" foca o campo de qualquer
 * tela do admin. O índice é `lib/admin/settings-index.ts`.
 */
export function SettingsSearch({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => searchSettings(query), [query]);
  const showList = open && query.trim().length > 0;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (entry: SettingEntry) => {
    const [path, anchor] = entry.href.split("#");
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    if (!anchor) {
      // Já nesta tela: relê, como o IntentLink faz (o push reaproveitaria o cache).
      if (path === pathname) router.refresh();
      else router.push(entry.href);
      return;
    }
    // Sem o scroll do Next: quem rola (e destaca) é o revealSetting, que espera a
    // âncora existir e respeita o header fixo (scroll-mt das âncoras).
    router.push(entry.href, { scroll: false });
    revealSetting(anchor);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      // Enter que fecha a composição (IME, acento morto no Safari) não navega.
      if (event.nativeEvent.isComposing) return;
      const entry = results[active];
      if (!showList || !entry) return;
      event.preventDefault();
      go(entry);
    } else if (event.key === "Escape") {
      if (query) setQuery("");
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      {/* 16px no celular: abaixo disso o Safari do iPhone dá zoom ao focar. */}
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Buscar configuração"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && results[active] ? optionId(active) : undefined
        }
        placeholder="buscar configuração"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="border-border bg-surface-2 sm:text-body-sm placeholder:text-muted-fg-2 focus-visible:ring-ring/50 h-8 w-full rounded-md border pr-8 pl-8 text-base tracking-tight focus-visible:ring-[3px] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd
        aria-hidden="true"
        className="border-border text-meta text-muted-foreground pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-sm border px-1 font-mono leading-none sm:block"
      >
        /
      </kbd>
      {/* mousedown, não click, em toda a lista (itens e barra de rolagem): o blur do
          campo fecharia a lista antes do click. */}
      <div
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          "border-border-subtle bg-popover text-popover-foreground absolute top-full right-0 z-30 mt-1 w-full min-w-72 overflow-hidden rounded-md border shadow-md sm:w-[26rem]",
          !showList && "hidden"
        )}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="Configurações encontradas"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {results.map((entry, i) => (
            <li
              key={entry.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onClick={() => go(entry)}
              onMouseMove={() => setActive(i)}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 px-3 py-2",
                i === active && "bg-surface-2"
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-body-sm font-medium">{entry.label}</span>
                <span className="text-meta text-muted-foreground shrink-0 font-mono">
                  {entry.kind}
                </span>
              </span>
              <span className="text-meta text-muted-foreground font-mono">
                {entry.where}
              </span>
              <span className="text-meta text-muted-foreground line-clamp-1">
                {entry.description}
              </span>
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <p className="text-body-sm text-muted-foreground px-3 py-2">
            Nenhuma configuração com “{query.trim()}”.
          </p>
        )}
      </div>
      {/* Sempre montado: uma região que aparece junto com o texto não é anunciada. */}
      <p role="status" aria-live="polite" className="sr-only">
        {!showList
          ? ""
          : results.length === 0
            ? "Nenhuma configuração encontrada."
            : results.length === 1
              ? "1 configuração encontrada."
              : `${results.length} configurações encontradas.`}
      </p>
    </div>
  );
}
