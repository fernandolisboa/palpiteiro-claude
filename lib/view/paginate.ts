// Paginação por página numerada (#577, tabela do Desempenho). Pura: a página vem crua
// da URL (`?page=`); inválida ou menor que 1 → 1; maior que o total → a última.

export type Page<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
};

export function paginate<T>(
  items: readonly T[],
  rawPage: string | undefined,
  pageSize = 25,
): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const parsed = rawPage !== undefined && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.min(Math.max(1, parsed), pageCount);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageCount, total };
}
