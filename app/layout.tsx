import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme-provider";
import { TimezoneSync } from "@/components/timezone-sync";
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
  title: "Palpiteiro",
  // Descrição palpite-first e neutra: multi-mercado (não só over/under 2.5) e SEM a frase
  // "Recomendações de aposta" (o posicionamento sancionado é "ferramenta de análise, não é
  // recomendação de aposta"). Esta descrição cascateia como fallback pra rotas sem metadata
  // própria — daí o cuidado regulatório (o segmento /p reafirma sua NEUTRAL_DESCRIPTION por
  // cima; ver app/p/layout.tsx). O overhaul completo de metadata (template/twitter/canonical)
  // é issue separada (#441).
  description:
    "Palpiteiro — palpites de futebol com IA, um por jogo, com o racional. Ferramenta de análise; não é casa de apostas.",
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
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <SiteFooter />
        </ThemeProvider>
        <TimezoneSync />
        <VersionChecker />
      </body>
    </html>
  );
}
