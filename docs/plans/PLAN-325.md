# PLAN — #325: de-slop do /perfil — fatia 7 (FINAL do épico #320)

> Plano de implementação (snapshot 2026-06-18). Fatia 7 (último heir) do épico **#320**. Herdeiro da
> fundação **#321** (ADR 0029) + precedentes #246/#322/#323/#331/#324. **Apresentação-only.** Derivado
> de censo read-only (5 agentes) byte-exato + síntese; passa por review adversarial 4-lentes antes da
> impl. Diferença vs #324: a issue **MANDA adotar os primitives `Input`/`Button`/`Select`** ("form
> controls sempre via primitives", ADR §B) — aqui adotamos de verdade (não parity-in-place). Sem
> `loading`/`error` (a issue #325 NÃO os escopa, ao contrário do #324).

## Princípio

Só apresentação, zero mudança de comportamento (server actions de perfil/modelo/passkey, validação,
auth, FormData contracts), paridade de dados/copy. Conduzido via `/impeccable` (perfil auth-gated →
owner logado no preview). Roteamos classes pros tokens, **adotamos** os primitives de form, e
**extraímos** 1 componente compartilhado (`ModelSelect`).

## Escopo (allowlist)

**Editados:** `app/perfil/page.tsx` · `app/perfil/profile-form.tsx` · `app/perfil/preferred-model-form.tsx` ·
`app/perfil/passkeys-section.tsx`.
**Novo:** `components/model-select.tsx` (ModelSelect — seam compartilhado) + este plano.

**NÃO tocar (consumir/referência):** `components/ui/*` (Input/Button/Select/Label/Card/Separator),
`components/empty-state.tsx`, `components/back-link.tsx` (já migrado, tem ring), `components/user-avatar.tsx`
(shell compartilhado; **preview de avatar no ProfileForm é OPCIONAL** — fora do escopo base),
`app/globals.css`, `components/dashboard/*`, **`components/model-override-select.tsx` + seus consumidores
match** (`new-analysis-form.tsx`, `section-footer-dispatch.tsx`) + `components/market-select.tsx` +
`components/__tests__/model-override-select.test.tsx`. **Cunhar token banido.** Server actions/validação
fora de escopo.

> **MUDANÇA vs draft (review lens A/D — match-page coherence):** o draft migrava
> `model-override-select.tsx` pro ModelSelect (h-9 + chevron do primitivo). **REVERTIDO.** O censo do
> review provou que `ModelOverrideSelect` renderiza **ao lado** do `MarketSelect` (h-8, sem chevron,
> `border-border`) em DOIS lugares do match (`new-analysis-form.tsx:174`, `section-footer-dispatch.tsx:116`),
> e `market-select.tsx` está **fora do escopo** do #325. Migrar só o model-override criaria um mismatch
> visível (h-8 vs h-9 + chevron + border) na mesma linha — **introduzir incoerência num épico cujo objetivo
> É coerência.** Decisão: `model-override-select` fica **INTOCADO** (já está de-slopado: tokens + ring). O
> "ModelSelect compartilhado entre perfil e análise" é **completado depois**, numa fatia de match que migra
> `model-override-select` **E** `market-select` JUNTOS (linha coerente). Pro #325, ModelSelect é criado e
> consumido só pelo perfil — é o **seam pronto** pra essa migração futura. Match page **zero-diff**.

**Nenhum golden cobre /perfil nem model-override-select** (golden = OddsCard/MatchRow/Upcoming). O único
teste que toca a área é `model-override-select.test.tsx` (class-agnostic: só texto de option + ordem).

## Vocabulário herdado (NÃO cunhar)

`text-eyebrow-xs`(9) `eyebrow`(10) `meta`(11) `body-sm`(12) `body`(13) `label`(14) `display-sm`(18)
`display-md`(26) `display-lg`(32); meio-pixel collapse 12.5→body-sm. `tracking-label`(0.14em) /
`tracking-tight`(stock, absorve -0.02em). Cor: **erro→`destructive`**, **sucesso→família `edge`
(`text-edge-fg`)** (NÃO `accent-fg`, que é link/azul-marca, ambíguo p/ sucesso — ADR §B mapa). Largura:
`max-w-aside`(320), `max-w-reading`(640). Foco: `focus-visible:outline-none focus-visible:ring-[3px]
focus-visible:ring-ring/50` (os primitives já trazem).

## Decisões globais

### 1. `ModelSelect` — componente compartilhado novo (`components/model-select.tsx`)

Consolida a **lista de opções duplicada** (`<option value="default">Usar padrão global ({defaultModelLabel})
</option>` + `models.map`) e o **select estilizado** dos dois model-selects. Owns SÓ o select+opções (cada
caller mantém seu próprio `<label>`/caption/helper, que divergem legitimamente). Suporta os DOIS modos
(controlled XOR uncontrolled) via spread de props no `<select>` do primitive:
```tsx
type Props = {
  models: { id: string; label: string }[];
  defaultModelLabel: string;
} & React.ComponentProps<"select">;   // name+defaultValue (form) OU value+onChange (controlled)

export function ModelSelect({ models, defaultModelLabel, ...selectProps }: Props) {
  return (
    <div className="max-w-aside">
      <Select {...selectProps}>
        <option value="default" className="bg-popover text-popover-foreground">
          Usar padrão global ({defaultModelLabel})
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id} className="bg-popover text-popover-foreground">
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
```
(Sem `"use client"` — só renderiza props; consumido por parent client.) **`bg-popover text-popover-foreground`
nas options é OBRIGATÓRIO** (workaround Chromium: não herda a cor do `<select>` pro popup nativo no dark). O
wrapper `<div className="max-w-aside">` envolve o `<div relative inline-flex w-full>` do primitivo (NÃO
remover — o `relative` ancora a chevron `absolute` do Select); ambos capam em 320 + `w-full` abaixo.
Suporta controlled (`value`+`onChange`) E uncontrolled (`name`+`defaultValue`) pelo spread (o XOR não é
enforçado em tipo — aceito pra esta fatia; os callers reais são corretos).

**Consumidor (#325): só o perfil.**
- `preferred-model-form.tsx:50-67` (UNCONTROLLED): `<ModelSelect name="preferredModelId" defaultValue={initial}
  models={models} defaultModelLabel={defaultModelLabel} />` — substitui o `<select>` hand-rolled (ganha
  primitivo + ring + chevron + color-scheme; `text-[12.5px]`→`text-body-sm` via primitivo; `w-80`→`max-w-aside`).
  Mantém o `<label>` + caption `<span>` (eyebrow) + helper `<span>`.

**`model-override-select.tsx` NÃO é tocado** (ver bloco "MUDANÇA vs draft" acima): já de-slopado; migrá-lo
agora quebraria a coerência da linha do AnalysisPanel vs o `MarketSelect` out-of-scope. ModelSelect existe
como o seam pronto pra fatia de match futura (model-override + market juntos). **Match page: zero-diff no #325.**

### 2. Form controls → primitives (MANDADO pela issue)

- **`Input`** (`ui/input.tsx`, `h-9 w-full border-input px-3 py-1 text-sm shadow-xs` + ring + aria-invalid):
  - `profile-form.tsx` 3 inputs (email `:25-31`, name `:41-49`, image `:56-62`). Preservar VERBATIM:
    email `value/disabled/readOnly/type=email` **sem `name`** (nunca submetido); name `name="name" required
    maxLength={80} defaultValue placeholder="Seu nome"`; image `name="image" type="url" defaultValue
    placeholder="https://…"`. **Largura:** dropar `w-80`; passar `className="max-w-aside"` (320 = w-80 atual,
    byte-idêntico, mas responsivo `w-full` abaixo de 320). Email mantém o look mutado via `className="max-w-aside
    text-muted-foreground"`. **NÃO byte-idêntico** (py-2→py-1, +h-9/shadow-xs/ring/border-input) — de-slop aceito,
    é o ponto da adoção.
- **`Button variant="default"`** (`ui/button.tsx`, bg-primary): submits inverted-fill (`profile-form:68-74`,
  `preferred-model:74-80`, passkeys "Registrar" `:122-129`). Preservar `type="submit"`/`type="button"`,
  `disabled={pending}`, troca de label (`Salvando…`/`Salvar`, `Registrando…`/`Registrar passkey`). Passar
  `className="w-fit"` (Button é inline-flex → não estica; preserva o w-fit original). **MUDANÇA de cor consciente:**
  `bg-foreground text-background`→`bg-primary text-primary-foreground` (variant default). É o que a issue MANDA
  (form controls via primitives → consistência com os ~10 Buttons da app). **CORREÇÃO review lens D:** NÃO é
  "consistência com #324" — o admin #324 MANTEVE `bg-foreground` (raw, não migrou pra Button, pois a issue #324
  não mandava). Logo perfil(bg-primary) diverge de admin(bg-foreground) → **flag de consistência cross-surface**
  (ver §Desvios; alinhar admin num follow-up).
- **`Button` "Remover"** (passkeys `:109-116`): hoje é OUTLINE com texto vermelho cru. → `<Button variant="outline"
  size="sm" className="text-destructive hover:text-destructive">` — preserva o look outline-discreto (não o
  filled-red gritante de `variant="destructive"`, pesado por-linha) + mata o `text-red-500` cru + ganha ring.
  Preservar `type="button"`, `disabled`, `Removendo…`/`Remover`. **Nota (review lens B):** adotar Button sobe o
  label `text-[12.5px]`→`text-sm`(14, base do Button size=sm) — shift consciente, igual aos inputs. **Flag
  /impeccable:** outline+text-destructive vs variant=destructive filled — owner decide o peso visual.
- **`Select`** via **ModelSelect** (decisão 1).
- **`Label` primitivo: NÃO consumir.** As captions são `<span>` mono-uppercase eyebrow em `<label className="flex
  flex-col gap-1">` (vertical); o Label primitivo é horizontal sans-medium — não casa, e forçá-lo divergiria das
  forms do admin (#324, que mantive como spans eyebrow). **Manter** `<label>` (associação implícita) + caption
  `<span>` tokenizado. **Desvio consciente** do critério "Label" (cross-surface consistency com #324). Flag owner.

### 3. Headings + tipografia + espaçamento (page.tsx)

- **h1 "Perfil" `:46` `text-[20px]`→`text-display-md`(26)** — unifica PRA CIMA (ADR §A.1: "h1 20px admin/perfil →
  display-md", igual #324); `tracking-[-0.02em]`→`tracking-tight`.
- **h2 "Modelo de análise" `:58` / "Passkeys" `:72` `text-[16px]`→`text-display-sm`(18)** — 16px sem degrau →
  sobe pro degrau on-scale `display-sm`(18), abaixo do h1(26): hierarquia **26>18 perceptível** (satisfaz o
  critério "H1>H2 perceptível" + "sem `text-[Npx]`"). `tracking-[-0.02em]`→`tracking-tight`.
- Subtítulos `:47/:61/:75` mono `text-[11px]`→`text-meta`(=); cor muted fica. **Ritmo único:** unificar
  `pb-6`(h1)/`pb-5`(h2) → **`pb-6`** nos três (consistência subtítulo→conteúdo).
- Dividers de seção `:57/:71` `border-t mt-10 pt-8` = stock, **mantidos** (não arbitrários).
- Container `:43` `max-w-[640px]`→`max-w-reading`(=). BackLink `:44` consumido (já tem ring).

### 4. Feedback semântico + a11y (os 3 forms)

- **profile-form `:78/:80`**, **preferred-model `:84/:86`**, **passkeys `:131-141`** (um `<p>` que alterna por
  `message.ok`):
  - sucesso `text-accent-fg`→**`text-edge-fg`**; erro `text-red-500`→**`text-destructive`**; `text-[13px]`→
    `text-body`(=). **CORREÇÃO review lens D (cross-surface):** o #325 MANDA sucesso→edge (accent é link/azul
    ambíguo). Mas o admin #324 (shipado hoje) MANTEVE sucesso→`accent-fg` (a issue #324 não pedia mudança).
    Seguimos o texto explícito do #325 (edge) — fica **mais correto** (ADR §B: positivo/confirmação = edge) —
    e **flagamos** que o admin deve alinhar `accent-fg`→`edge-fg` no sucesso num follow-up (out of #325 scope),
    pro épico fechar consistente.
  - **a11y:** sucesso `role="status"` + `aria-live="polite"`; erro `role="alert"` (live assertive implícito).
    **`aria-describedby` NÃO aplicado** — o feedback é **form-level** (um `<p>` no rodapé, não erro de campo
    específico); `role="status"/"alert"` é o padrão correto p/ status de form, `aria-describedby` é p/ ajuda/erro
    de campo. Desvio documentado do literal "aria-describedby ligando ao campo".

### 5. Captions, helpers, passkey rows

- Captions de campo (mono eyebrow) `text-[10px]`→`text-eyebrow`(=) + `tracking-[0.14em]`→`tracking-label`(=)
  (profile-form `:22/:38/:53`, preferred-model `:47`). Helpers `text-[11px]`→`text-meta`(=) (profile-form
  `:32/:63`, preferred-model `:68`).
- **passkeys-section:** empty `<p>` `:92-95`→**`EmptyState`** (ícone lucide `KeyRound`, `strokeWidth={1.25}`;
  título+descrição = a copy atual VERBATIM, split em title/description). Item `:104` `text-[13px]`→`text-body`(=);
  credentialID `:105-107` `text-[10px]`→`text-eyebrow`(=). `<li>` row `:99-101` (border rounded-md) = stock, fica.

## Mapa por arquivo (resumo — censo byte-exato; `=` byte-idêntico, `~` shift consciente)

- **`page.tsx`**: `:43` max-w-reading(=); `:46` h1→display-md(~)+tracking-tight; `:47` →meta(=) pb-6; `:58/:72`
  h2→display-sm(~)+tracking-tight; `:61/:75` →meta(=) pb-5→pb-6. Server component, sem primitive (sem control).
- **`profile-form.tsx`**: captions `:22/:38/:53`→eyebrow+tracking-label(=); inputs `:30/:48/:61`→`Input
  className="max-w-aside"`(~); helpers `:32/:63`→meta(=); submit `:71`→`Button variant=default className="w-fit"`(~);
  feedback `:78`→edge-fg+body+`role=status aria-live`; `:80`→destructive+body+`role=alert`.
- **`preferred-model-form.tsx`**: caption `:47`→eyebrow+tracking-label(=); select `:50-67`→`ModelSelect name=
  "preferredModelId" defaultValue={initial}`(~); helper `:68`→meta(=); submit `:77`→`Button variant=default w-fit`(~);
  feedback `:84`→edge-fg+body+role=status; `:86`→destructive+body+role=alert.
- **`passkeys-section.tsx`**: empty `:92-95`→`EmptyState`(KeyRound); item `:104`→body(=); cred `:105-107`→eyebrow(=);
  "Remover" `:109-116`→`Button variant=outline size=sm text-destructive`; "Registrar" `:122-129`→`Button variant=
  default w-fit`; feedback `:131-141`→edge-fg/destructive+body+`role` (alterna por message.ok).
- **`model-override-select.tsx`**: **INTOCADO** (deferido — ver bloco "MUDANÇA vs draft"). ModelSelect é o seam
  pronto pra migração futura (model-override + market juntos).

## Testes / verificação

- `model-override-select.test.tsx` — class-agnostic (texto de option "Usar padrão global (…)" + ordem dos
  models). ModelSelect renderiza as mesmas options na mesma ordem → **passa sem update**.
- Nenhum golden cobre /perfil nem model-override-select.
- Tríade: `pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism && pnpm build` (todas verdes).
- Grep anti-resíduo nos arquivos editados:
  `text-\[[0-9]|tracking-\[[0-9.]+em\]|rounded-\[[0-9]|shadow-\[|amber-|emerald-|sky-|red-[0-9]|#[0-9a-f]{3,6}|\btext-sm\b`
  → 0 hits (sem outlier comentado aqui — 20/16px viram tokens; `text-sm` herdado do Input/Button primitivo é
  INTERNO ao primitivo, não nos arquivos editados).
- Worktree guard (branch da feature). **"Fecha #325" PT-BR não auto-fecha** → fechar manual.
- `/impeccable` (perfil auth-gated → owner logado): foco visível em todos os controles + BackLink; par
  sucesso(edge)/erro(destructive); H1(26)>H2(18); inputs `max-w-aside` responsivos; submit fill primário;
  "Remover" outline+destructive; EmptyState de passkeys. **Match page: zero-diff (model-override intocado).**

## Desvios conscientes do texto da issue

- **`ModelSelect` compartilhado entre perfil e análise: PARCIALMENTE DEFERIDO** (review lens A/D). Criado +
  consumido só pelo perfil; `model-override-select` (análise) fica **intocado** pra não criar mismatch h-8/h-9
  + chevron com o `MarketSelect` out-of-scope na linha do AnalysisPanel. A migração da análise (model-override
  + market JUNTOS) é fatia de match futura. ModelSelect é o seam pronto.
- **`Label` primitivo NÃO consumido** (captions eyebrow ≠ Label sans; consistência com admin #324). Captions
  ficam `<span>` tokenizado em `<label>` (associação implícita).
- **`aria-describedby` não aplicado** (feedback é form-level → `role=status/alert`+`aria-live`, não describedby de campo).
- **"Remover" = `variant="outline" + text-destructive`** (não `variant="destructive"` filled) — preserva o peso
  visual discreto; flag /impeccable.
- **h2 16→display-sm(18)** (sobe pro degrau on-scale; análogo ao precedente ADR §A.1 "15px heading→display-sm"
  — off-scale arredonda pro degrau display mais próximo pra cima; melhora hierarquia H1(26)>H2(18)).
- **Sucesso→`edge-fg` + submits→`Button` (bg-primary): divergem do admin #324** (que manteve sucesso=accent-fg
  e submits=bg-foreground raw, porque a issue #324 não pedia). Seguimos o texto explícito do #325 (mais correto
  pela ADR). **Flag cross-surface:** alinhar admin (accent→edge no sucesso; raw-buttons→Button) num follow-up
  pequeno pro épico fechar consistente.
- **`w-80`→`max-w-aside`(320)** (w-full responsivo capado em 320 = largura atual byte; não widening).
- **`ModelSelect` owns só select+opções** (caller mantém caption/helper): unifica a duplicação real (option list
  + estilo do primitivo) sem forçar unificação de caption.

## Fora de escopo

Server actions/validação/auth; preview de avatar (opcional); `loading`/`error` (não escopados pelo #325);
editar `ui/*`/`empty-state`/`back-link`/`user-avatar`/`globals.css`/`dashboard/*`/o teste/os consumidores match;
cunhar token; mudar copy/dado/FormData names; migrar outras superfícies.
