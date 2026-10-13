"use server";

import { signOut } from "@/auth";

/**
 * Logout server action para uso a partir de Client Components (o drawer do
 * celular em `mobile-nav.tsx` e o menu da conta em `components/nav/account-menu.tsx`,
 * que são "use client" e não podem inlinar uma server action). Reusa a porta
 * `signOut` do `@/auth` com `redirectTo: "/signin"`.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
