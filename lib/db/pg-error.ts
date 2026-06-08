/**
 * Drizzle envolve erros do driver num `DrizzleQueryError` cuja `message` é só o
 * wrapper `"Failed query: <sql>\nparams: <params>"` — o erro REAL do Postgres
 * fica escondido em `.cause`. No driver neon-http esse cause é um `NeonDbError`
 * com os campos do libpq como props próprias: `code` (SQLSTATE), `constraint`,
 * `detail`, `table`, `column`. Sem extrair isso, uma violação de FK/constraint
 * vira um log opaco "Failed query: insert into ..." e some como "unexpected".
 *
 * Caminha a cadeia de `.cause` e lê os campos de forma ESTRUTURAL (sem
 * `instanceof`), pra sobreviver a duplicação de bundle / driver trocado.
 */
export type DbCause = {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
  schema?: string;
  message: string;
};

export function extractDbCause(err: unknown): DbCause {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null; i++) {
    const e = cur as Record<string, unknown>;
    if (typeof e.code === "string" || typeof e.constraint === "string") {
      return {
        code: typeof e.code === "string" ? e.code : undefined,
        constraint: typeof e.constraint === "string" ? e.constraint : undefined,
        detail: typeof e.detail === "string" ? e.detail : undefined,
        table: typeof e.table === "string" ? e.table : undefined,
        column: typeof e.column === "string" ? e.column : undefined,
        schema: typeof e.schema === "string" ? e.schema : undefined,
        message: e instanceof Error ? e.message : String(e.message ?? cur),
      };
    }
    cur = e.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}
