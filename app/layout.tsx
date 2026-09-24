import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme-provider";
import { TimezoneSync } from "@/components/timezone-sync";
import { THEME_PROVIDER_PROPS } from "@/lib/theme";
import { VersionChecker } from "@/components/version-checker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://palpiteiro.live"),
  // `default` é o título de rotas sem `title` próprio; `template` embrulha os que
  // têm (ex.: "%s · Palpiteiro"). Rotas que já definem título absoluto (landing,
  // como-funciona) serão reconciliadas no restante do #441 — este PR é o subset.
  title: {
    default: "Palpiteiro — palpites de futebol com IA",
    template: "%s · Palpiteiro",
  },
  // Descrição palpite-first e neutra: multi-mercado (não só over/under 2.5) e SEM a frase
  // "Recomendações de aposta" (o posicionamento sancionado é "ferramenta de análise, não é
  // recomendação de aposta"). Esta descrição cascateia como fallback pra rotas sem metadata
  // própria — daí o cuidado regulatório (o segmento /p reafirma sua NEUTRAL_DESCRIPTION por
  // cima; ver app/p/layout.tsx).
  description:
    "Palpiteiro — palpites de futebol com IA, um por jogo, com o racional. Ferramenta de análise; não é casa de apostas.",
  // Defaults de share herdados por rotas sem openGraph/twitter próprios. Rotas que
  // definem o seu (landing, /p) substituem o objeto inteiro (merge raso do Next), o
  // que preserva a NEUTRAL_DESCRIPTION do /p — nenhum campo novo vaza pra lá.
  openGraph: {
    siteName: "Palpiteiro",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider {...THEME_PROVIDER_PROPS}>
          {children}
          <SiteFooter />
        </ThemeProvider>
        <TimezoneSync />
        <VersionChecker />
      </body>
    </html>
  );
}
