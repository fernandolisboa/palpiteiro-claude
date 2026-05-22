import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function MatchNotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[480px] px-5 pt-16">
        <Card className="px-6 py-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-fg-2">
              404
            </span>
            <span className="text-[16px] font-medium tracking-tight">
              Jogo não encontrado
            </span>
            <span className="max-w-[280px] text-[12.5px] text-muted-foreground tracking-tight">
              Este id não corresponde a nenhum jogo das próximas 48h. Ele pode ter sido
              removido, adiado ou nunca existiu.
            </span>
            <Button asChild size="sm" variant="secondary" className="mt-2">
              <Link href="/">
                <ChevronLeft className="size-3.5" /> Voltar para a lista
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
