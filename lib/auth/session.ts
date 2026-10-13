import { cache } from "react";

import { auth } from "@/auth";

/**
 * `auth()` memoizado por request. No Node, cada `auth()` revalida o token contra o DB
 * (`jwt-revalidate.ts`); o layout do grupo `(app)` e o layout do admin pedem a sessão
 * no mesmo request, e assim pagam uma leitura só.
 */
export const getSession = cache(() => auth());
