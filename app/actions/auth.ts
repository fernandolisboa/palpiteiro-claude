"use server";

import { signOut } from "@/auth";

/**
 * Logout server action para uso a partir de Client Components (o menu da conta em
 * `components/nav/account-menu.tsx`, no computador e no celular, que é "use client"
 * e não pode inlinar uma server action). Reusa a porta
 * `signOut` do `@/auth` com `redirectTo: "/signin"`.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
