import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

type Db = NeonHttpDatabase<typeof schema>;

let cachedSql: NeonQueryFunction<false, false> | undefined;
let cachedDb: Db | undefined;

function buildDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Define it in .env.local (see .env.example).",
    );
  }
  cachedSql = neon(url);
  return drizzle(cachedSql, { schema, casing: "snake_case" });
}

/**
 * Lazy Proxy: difere a construção do cliente neon (que valida o formato da
 * URL no construtor) até a primeira query. Isto permite que `next build`
 * importe módulos que dependem de `db` sem precisar de DATABASE_URL no
 * ambiente de build — o erro só dispara em runtime caso a env var esteja
 * de fato faltando.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!cachedDb) cachedDb = buildDb();
    const value = Reflect.get(cachedDb, prop, receiver);
    return typeof value === "function" ? value.bind(cachedDb) : value;
  },
  // O DrizzleAdapter (@auth/drizzle-adapter) faz `is(db, PgDatabase)`, que
  // inspeciona a cadeia de protótipos — não passa pelo trap `get`. Sem este
  // trap, o Proxy resolve para Object.prototype e o adapter rejeita o cliente
  // com "Unsupported database type". Resolver o protótipo real força a
  // construção lazy aqui (DATABASE_URL é garantido no build: o script é
  // `drizzle-kit migrate && next build`).
  getPrototypeOf() {
    if (!cachedDb) cachedDb = buildDb();
    return Object.getPrototypeOf(cachedDb);
  },
});
