import { Wordmark } from "@/components/wordmark";

// Skeleton mínimo do /p (ADR 0035 / #384): primeiro paint num link público aberto a frio
// (Neon cold-start ~1s). Sem chrome autenticado — só a marca + um placeholder quieto.
export default function PublicPalpiteLoading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-5 py-4">
        <Wordmark />
      </header>
      <div className="mx-auto w-full max-w-content px-5 py-8">
        <div className="flex flex-col gap-4 rounded-xl border border-palpite-border bg-palpite-soft/40 p-5 lg:p-6">
          <div className="h-5 w-24 rounded-full bg-palpite-soft" />
          <div className="flex flex-col gap-2.5">
            <div className="h-8 w-3/4 rounded-md bg-palpite-soft" />
            <div className="h-8 w-1/2 rounded-md bg-palpite-soft" />
          </div>
          <div className="h-4 w-40 rounded-md bg-palpite-soft" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-full rounded-md bg-palpite-soft/70" />
            <div className="h-3 w-5/6 rounded-md bg-palpite-soft/70" />
          </div>
        </div>
      </div>
    </main>
  );
}
