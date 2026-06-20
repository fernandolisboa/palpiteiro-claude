import { Wordmark } from "@/components/wordmark";

// 404 público mínimo do /p (ADR 0035 §6 / #384): cobre o kill-switch (set sem shared_at →
// getSharedPalpiteSet null → notFound) E os 3 triggers de 404, pousando numa casca pública
// limpa (sem nav/DesktopShell autenticados). Não é o 404 da raiz autenticada/landing.
export default function PublicPalpiteNotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-5 py-4">
        <Wordmark />
      </header>
      <div className="mx-auto flex w-full max-w-content flex-col gap-2 px-5 py-16">
        <h1 className="text-display-md font-medium tracking-tight">
          Esse palpite não está disponível.
        </h1>
        <p className="text-body tracking-tight text-muted-foreground">
          O link pode ter expirado ou o palpite deixou de ser compartilhado.
        </p>
      </div>
    </main>
  );
}
