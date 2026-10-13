"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  addFriendPoolEntry,
  createFriendPool,
  setFriendPoolScore,
  type PoolActionResult,
} from "@/app/actions/friend-pools";
import type { PoolBetKind } from "@/lib/pools/pool-schema";

// Formulários do bolão entre amigos (#567). A regra mora nas actions e em lib/pools;
// aqui só estado de campo e mensagem de erro.

const LABEL = "text-muted-foreground text-eyebrow font-mono tracking-label uppercase";

function ErrorLine({ state }: { state: PoolActionResult | null }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="text-destructive text-body-sm">
      {state.error}
    </p>
  );
}

export type PoolMatchOption = { id: string; label: string };

export function NewPoolForm({
  options,
  defaultMatchId,
}: {
  options: readonly PoolMatchOption[];
  defaultMatchId: string | null;
}) {
  const [state, action, pending] = useActionState<PoolActionResult | null, FormData>(
    createFriendPool,
    null,
  );

  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-body-sm">
        Nenhum jogo nos próximos dias nas ligas ativas. Quando a tabela tiver jogos, eles
        aparecem aqui.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>jogo</span>
        <Select
          name="matchId"
          required
          defaultValue={defaultMatchId ?? ""}
          aria-label="Jogo do bolão"
        >
          <option value="" disabled>
            Escolha o jogo
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>nome do bolão (opcional)</span>
          <Input name="title" maxLength={60} placeholder="Bolão de sábado" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>valor por pessoa (opcional)</span>
          <Input name="entryAmount" inputMode="decimal" placeholder="R$ 10,00" />
        </label>
      </div>
      <ErrorLine state={state} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Criando…" : "Criar bolão"}
      </Button>
    </form>
  );
}

const KIND_OPTIONS: ReadonlyArray<{ kind: PoolBetKind; label: string }> = [
  { kind: "exact_score", label: "Placar exato" },
  { kind: "match_result", label: "Resultado" },
  { kind: "double_chance", label: "Dupla chance" },
  { kind: "btts", label: "Os dois marcam?" },
  { kind: "over_under", label: "Total de gols" },
];

function pickOptions(kind: PoolBetKind, home: string, away: string) {
  switch (kind) {
    case "match_result":
      return [
        { value: "home", label: `Vitória do ${home}` },
        { value: "draw", label: "Empate" },
        { value: "away", label: `Vitória do ${away}` },
      ];
    case "double_chance":
      return [
        { value: "home_draw", label: `${home} ou empate` },
        { value: "home_away", label: `${home} ou ${away}` },
        { value: "draw_away", label: `Empate ou ${away}` },
      ];
    case "btts":
      return [
        { value: "yes", label: "Sim, os dois marcam" },
        { value: "no", label: "Não, pelo menos um não marca" },
      ];
    case "over_under":
      return [1.5, 2.5, 3.5].flatMap((line) => {
        const l = String(line).replace(".", ",");
        return [
          { value: `over:${line}`, label: `Mais de ${l} gols` },
          { value: `under:${line}`, label: `Menos de ${l} gols` },
        ];
      });
    default:
      return [];
  }
}

export function AddEntryForm({
  poolId,
  homeTeam,
  awayTeam,
}: {
  poolId: string;
  homeTeam: string;
  awayTeam: string;
}) {
  const [state, action, pending] = useActionState<PoolActionResult | null, FormData>(
    addFriendPoolEntry,
    null,
  );
  const [kind, setKind] = useState<PoolBetKind>("exact_score");
  const nameRef = useRef<HTMLInputElement>(null);

  // Depois de gravar, o React reseta o form; o foco volta pro nome pro próximo amigo.
  useEffect(() => {
    if (state?.ok) nameRef.current?.focus();
  }, [state]);

  const picks = pickOptions(kind, homeTeam, awayTeam);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>apostador</span>
          <Input
            ref={nameRef}
            name="bettorName"
            required
            maxLength={40}
            autoComplete="off"
            placeholder="Nome"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>tipo de aposta</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as PoolBetKind)}
            aria-label="Tipo de aposta"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {kind === "exact_score" ? (
        <fieldset className="flex flex-col gap-1">
          <legend className={LABEL}>placar</legend>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-body-sm">{homeTeam}</span>
            <Input
              name="home"
              required
              inputMode="numeric"
              pattern="\d{1,2}"
              maxLength={2}
              aria-label={`Gols do ${homeTeam}`}
              className="w-14 text-center"
            />
            <span aria-hidden>×</span>
            <Input
              name="away"
              required
              inputMode="numeric"
              pattern="\d{1,2}"
              maxLength={2}
              aria-label={`Gols do ${awayTeam}`}
              className="w-14 text-center"
            />
            <span className="text-body-sm">{awayTeam}</span>
          </div>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>aposta</span>
          <Select key={kind} name="pick" required defaultValue="" aria-label="Aposta">
            <option value="" disabled>
              Escolha
            </option>
            {picks.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
      )}

      <ErrorLine state={state} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Anotando…" : "Anotar aposta"}
      </Button>
    </form>
  );
}

export function ManualScoreForm({
  poolId,
  homeTeam,
  awayTeam,
  manual,
}: {
  poolId: string;
  homeTeam: string;
  awayTeam: string;
  manual: { home: number; away: number } | null;
}) {
  const [state, action, pending] = useActionState<PoolActionResult | null, FormData>(
    setFriendPoolScore,
    null,
  );
  return (
    <form
      key={manual ? `${manual.home}-${manual.away}` : "none"}
      action={action}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="poolId" value={poolId} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm">{homeTeam}</span>
        <Input
          name="home"
          inputMode="numeric"
          pattern="\d{1,2}"
          maxLength={2}
          defaultValue={manual?.home ?? ""}
          aria-label={`Gols do ${homeTeam}`}
          className="w-14 text-center"
        />
        <span aria-hidden>×</span>
        <Input
          name="away"
          inputMode="numeric"
          pattern="\d{1,2}"
          maxLength={2}
          defaultValue={manual?.away ?? ""}
          aria-label={`Gols do ${awayTeam}`}
          className="w-14 text-center"
        />
        <span className="text-body-sm">{awayTeam}</span>
      </div>
      <ErrorLine state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="set" disabled={pending} className="w-fit">
          {pending ? "Salvando…" : "Usar este placar"}
        </Button>
        {manual && (
          <Button
            type="submit"
            name="intent"
            value="clear"
            variant="outline"
            disabled={pending}
            formNoValidate
            className="w-fit"
          >
            Voltar pro placar do jogo
          </Button>
        )}
      </div>
    </form>
  );
}
