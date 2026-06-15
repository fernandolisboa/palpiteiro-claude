import type { DefaultSession } from "next-auth";

type UserRole = "admin" | "user";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      // Acesso (whitelist em DB, ADR 0009 / 0023) revalidado a cada `jwt()` no
      // Node — exposto aqui pra que Server Components/Actions vejam o estado vivo.
      allowed?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    // Revalidado do DB no `jwt()` do Node (auth.ts) a cada invocação — não é
    // carimbado no edge (auth.config.ts fica DB-free). Ver ADR 0023.
    allowed?: boolean;
  }
}
