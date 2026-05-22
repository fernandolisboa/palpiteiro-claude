/**
 * Placeholder user id usado em Server Actions e queries de predição enquanto
 * não há sessão real. Hardcoded como literal pra:
 *
 *   - Sobreviver a `next build` em CI (sem DATABASE_URL disponível).
 *   - Garantir seed determinístico: db/seed.ts insere o admin com este UUID.
 *
 * UUID v4 com bits de variant/version corretos. NÃO mudar sem migrar/reseed.
 *
 * TODO: substituir por sessão real (auth()/getServerSession) na issue #12.
 */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001" as const;
