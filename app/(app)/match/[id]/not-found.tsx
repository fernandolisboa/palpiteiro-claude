import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function MatchNotFound() {
  return (
    <main className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-narrow px-5 pt-16">
        <Card className="px-6 py-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
              404
            </span>
            <span className="text-display-sm font-medium tracking-tight">
              Jogo não encontrado
            </span>
            <span className="max-w-[280px] text-body-sm text-muted-foreground tracking-tight">
              Não achamos esse jogo. Ele pode ter sido removido ou o link está
              incompleto.
            </span>
            <Button asChild size="sm" variant="secondary" className="mt-2">
              <Link href="/jogos">
                <ChevronLeft className="size-3.5" /> Voltar para a lista
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
