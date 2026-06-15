"use server";

import { signOut } from "@/auth";

/**
 * Logout server action para uso a partir de Client Components (ex.: o drawer
 * mobile em `mobile-nav.tsx`, que é "use client" e não pode inlinar uma server
 * action como o `DesktopShell`). Reusa a mesma porta `signOut` do `@/auth` e o
 * mesmo `redirectTo: "/signin"` do desktop, pra comportamento idêntico.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
