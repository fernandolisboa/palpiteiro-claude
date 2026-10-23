import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import { renderToStaticMarkup } from "react-dom/server";

import { AppIconMark, BRAND_BLUE } from "@/components/brand/app-icon-mark";
import { markGlyph } from "@/components/brand/brand-mark";

// Arquivos da marca pra uso FORA do app (ADR 0067): tela de consentimento do Google, perfil
// de rede social, apresentação. O app não lê nada daqui: os ícones e cards dele são gerados
// em código. Tudo sai da mesma geometria (brand-mark.tsx) e o PNG pelo mesmo renderizador
// do app (next/og), então ficar igual ao app é questão de rodar `pnpm brand:export`; o teste
// scripts/__tests__/brand-assets.test.ts falha se o que está versionado ficar pra trás.

export const BRAND_ASSETS_DIR = "docs/brand";

export type BrandAsset = { file: string; bytes: Buffer };

// rx 22 = mesmo arredondamento do ícone da aba/manifest (AppIconMark, 0.22 do lado).
function symbolSvg({ px, rounded }: { px: number; rounded: boolean }) {
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 100 100"
    >
      <rect width="100" height="100" rx={rounded ? 22 : 0} fill={BRAND_BLUE} />
      {markGlyph(BRAND_BLUE)}
    </svg>
  );
  return Buffer.from(`${markup}\n`, "utf8");
}

async function symbolPng({ px, rounded }: { px: number; rounded: boolean }) {
  const res = new ImageResponse(<AppIconMark size={px} rounded={rounded} />, {
    width: px,
    height: px,
  });
  return Buffer.from(await res.arrayBuffer());
}

// Geist SemiBold embutida (OFL, scripts/fonts/Geist-OFL.txt): é a fonte do nome no app, e o
// next/og sozinho só traz a Noto Sans. Só este script lê o arquivo; o app usa next/font.
const GEIST_SEMIBOLD = join(process.cwd(), "scripts/fonts/Geist-SemiBold.ttf");

// Logo da tela de consentimento do OAuth do Google: o símbolo com o nome embaixo, em branco,
// 120×120. O Google mostra o logo recortado em círculo, então o nome fica dentro da corda
// do círculo na altura dele (≈ 100px a y 92) e o símbolo não encosta nas bordas.
async function googleLockupPng() {
  const res = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#ffffff",
      }}
    >
      <div style={{ display: "flex", width: 56, height: 56 }}>
        <AppIconMark size={56} rounded />
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: "Geist",
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: -0.36,
          lineHeight: 1,
          color: "#0a0a0a",
        }}
      >
        palpiteiro
      </div>
    </div>,
    {
      width: 120,
      height: 120,
      fonts: [
        {
          name: "Geist",
          data: readFileSync(GEIST_SEMIBOLD),
          weight: 600,
          style: "normal",
        },
      ],
    }
  );
  return Buffer.from(await res.arrayBuffer());
}

export async function renderBrandAssets(): Promise<BrandAsset[]> {
  return [
    {
      file: "palpiteiro-simbolo.svg",
      bytes: symbolSvg({ px: 512, rounded: true }),
    },
    {
      file: "palpiteiro-simbolo-quadrado.svg",
      bytes: symbolSvg({ px: 512, rounded: false }),
    },
    {
      file: "palpiteiro-simbolo-512.png",
      bytes: await symbolPng({ px: 512, rounded: true }),
    },
    {
      file: "palpiteiro-simbolo-quadrado-512.png",
      bytes: await symbolPng({ px: 512, rounded: false }),
    },
    { file: "palpiteiro-google-oauth-120.png", bytes: await googleLockupPng() },
  ];
}
