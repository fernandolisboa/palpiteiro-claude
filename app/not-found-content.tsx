import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Cartão do 404 próprio (#574 linha 12), síncrono pra ser testável fora do casco
// (o `app/not-found.tsx` embrulha no AppShell, que lê a sessão).
export function NotFoundContent() {
  return (
    <main className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-narrow px-5 pt-16">
        <Card className="px-6 py-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
              404
            </span>
            <h1 className="text-display-sm font-medium tracking-tight">
              Página não encontrada
            </h1>
            <p className="max-w-[280px] text-body-sm text-muted-foreground tracking-tight">
              O endereço pode estar errado ou a página saiu do ar.
            </p>
            <Button asChild size="sm" variant="secondary" className="mt-2">
              <Link href="/jogos">
                <ChevronLeft className="size-3.5" /> Ir para os jogos
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
