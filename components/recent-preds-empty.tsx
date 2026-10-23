import { IntentLink } from "@/components/intent-link";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { appendBackParam } from "@/lib/view/back-href";

// Estado vazio de "Suas predições recentes" (#446): no primeiro acesso a seção explica
// o que aparece ali e leva direto ao próximo jogo analisável da lista. Sem jogo
// analisável na lista (filtro vazio, só jogos já começados), o atalho vai pro guia.
export function RecentPredsEmpty({
  nextMatchId,
  listHref,
}: {
  nextMatchId: string | null;
  // URL filtrada da lista (/jogos?…) → preserva o estado de busca ao voltar.
  listHref?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border">
      <EmptyState
        className="py-6"
        title="Nenhuma predição ainda"
        description='Abra um jogo e toque em "Analisar com IA". Os últimos jogos que você analisar aparecem aqui.'
        action={
          <Button asChild size="sm" variant="secondary">
            {nextMatchId ? (
              <IntentLink href={appendBackParam(`/match/${nextMatchId}`, listHref, "/jogos")}>
                Abrir o próximo jogo
              </IntentLink>
            ) : (
              <IntentLink href="/como-usar">Ver como usar</IntentLink>
            )}
          </Button>
        }
      />
    </div>
  );
}
