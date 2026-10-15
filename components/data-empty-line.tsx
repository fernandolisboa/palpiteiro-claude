// Bloco da aba Dados sem dado (#576): uma linha (título à esquerda, motivo à direita) no
// lugar de um cartão aberto com um estado vazio grande.
export function DataEmptyLine({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-3">
      <span className="text-body tracking-tight">{title}</span>
      <span className="text-right text-body-sm text-muted-foreground tracking-tight">
        {reason}
      </span>
    </div>
  );
}
