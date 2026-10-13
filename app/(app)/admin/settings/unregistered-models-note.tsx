import { MODEL_REGISTRY } from "@/lib/ai/models";
import {
  listApiModels,
  unregisteredApiModels,
} from "@/lib/ai/providers/anthropic/models-catalog";

// Aviso "modelos na API ainda sem cadastro" (#524). Server Component assíncrono
// renderizado dentro de um <Suspense> na página: a listagem (GET /v1/models, 5s
// por request, sem retry) nunca segura o resto de /admin/settings. Falha em
// silêncio (sem chave/erro → nada renderizado).
export async function UnregisteredModelsNote() {
  const unregistered = unregisteredApiModels(
    await listApiModels(),
    Object.keys(MODEL_REGISTRY),
  );
  if (unregistered.length === 0) return null;
  return (
    <div role="note" className="mt-3 text-body-sm text-muted-foreground">
      <p>
        Modelos disponíveis na API ainda sem cadastro (a API não informa preço;
        cadastro manual em lib/ai/models.ts):
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {unregistered.map((m) => (
          <li key={m.id} className="font-mono text-eyebrow">
            {m.id}
            {m.displayName ? ` · ${m.displayName}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
