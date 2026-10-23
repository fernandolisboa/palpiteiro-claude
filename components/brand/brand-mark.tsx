import { cn } from "@/lib/utils";

// Símbolo da marca (ADR 0067, #637): a trave de frente com os cantos arredondados e a bola
// amarela entrando no ângulo, com o rastro do chute. A trave direita fica esmaecida, como o
// trecho não preenchido de um medidor. Geometria única num viewBox 100×100, usada pelo
// Satori (ícones e cards OG, via app-icon-mark.tsx) e pelo DOM (Wordmark). Só atributos de
// SVG, sem `style`, CSS nem `clipPath`: o Satori e o resvg leem os dois iguais, e sem id não
// há colisão quando o símbolo aparece mais de uma vez na página.

const r2 = (n: number) => Math.round(n * 100) / 100;
const polar = (
  cx: number,
  cy: number,
  r: number,
  deg: number
): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
};

export const MARK_STROKE = 10;
// Trave esquerda + travessão num traço só; o canto é uma curva, nem quadrado nem redondo.
export const MARK_FRAME = "M18 84V44C18 29 27 22 42 22H58C73 22 82 29 82 44";
export const MARK_RIGHT_POST = "M82 44V84";
export const MARK_DIM_OPACITY = 0.32;
export const MARK_BALL = { cx: 62.5, cy: 41.5, r: 12.5 } as const;
export const MARK_BALL_COLOR = "#ffb547";

const { cx, cy, r } = MARK_BALL;
// Cinco direções da bola, a partir do topo (0° = 3h, sentido horário da tela).
const BALL_DIRS = [0, 1, 2, 3, 4].map((i) => -90 + i * 72);

// Gomos da bola, vazados na cor do fundo: pentágono no meio, costuras saindo dele e meias-luas
// na borda. A meia-lua é a interseção de um círculo de raio 0,34r (centro a 1,17r) com a bola,
// desenhada como lente pra dispensar o clipPath.
const PATCH_R = r * 0.34;
const PATCH_D = r * 1.17;
const PATCH_HALF_DEG =
  (Math.acos(
    (PATCH_D * PATCH_D + r * r - PATCH_R * PATCH_R) / (2 * PATCH_D * r)
  ) *
    180) /
  Math.PI;

export const MARK_BALL_PENTAGON = BALL_DIRS.map((a) =>
  polar(cx, cy, r * 0.36, a).join(" ")
).join(" ");
export const MARK_BALL_SEAMS = BALL_DIRS.map((a) => [
  ...polar(cx, cy, r * 0.34, a),
  ...polar(cx, cy, r, a),
]);
export const MARK_BALL_PATCHES = BALL_DIRS.map((a) => {
  const [x1, y1] = polar(cx, cy, r, a - PATCH_HALF_DEG);
  const [x2, y2] = polar(cx, cy, r, a + PATCH_HALF_DEG);
  const pr = r2(PATCH_R);
  return `M${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}A${pr} ${pr} 0 0 1 ${x1} ${y1}Z`;
});
const SEAM_WIDTH = r2(r * 0.126);

// Rastro do chute: três traços que saem da pequena área e param a 16 do centro da bola.
export const MARK_TRAILS = (
  [
    [28, 70],
    [34, 78],
    [44, 80],
  ] as const
).map(([x1, y1]) => {
  const k = (Math.hypot(cx - x1, cy - y1) - 16) / Math.hypot(cx - x1, cy - y1);
  return [x1, y1, r2(x1 + (cx - x1) * k), r2(y1 + (cy - y1) * k)] as const;
});

const WHITE = "#ffffff";

/**
 * Os traços do glifo: trave e rastro em branco, bola em amarelo, gomos na cor `cut`, que tem
 * que ser a do fundo do símbolo (hex no Satori, `currentColor` no DOM).
 */
export function markGlyph(cut: string) {
  return [...markGoal(), ...markBall(cut)];
}

/** Só a trave e o rastro (o mascote, parrot-mascot.tsx, anima a trave e a bola em separado). */
export function markGoal() {
  const white = WHITE;
  return [
    ...MARK_TRAILS.map(([x1, y1, x2, y2], i) => (
      <line
        key={`trail-${i}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={white}
        strokeOpacity={MARK_DIM_OPACITY}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    )),
    <path
      key="right-post"
      d={MARK_RIGHT_POST}
      fill="none"
      stroke={white}
      strokeOpacity={MARK_DIM_OPACITY}
      strokeWidth={MARK_STROKE}
    />,
    <path
      key="frame"
      d={MARK_FRAME}
      fill="none"
      stroke={white}
      strokeWidth={MARK_STROKE}
    />,
  ];
}

/** Só a bola, no ângulo, com os gomos vazados em `cut`. */
export function markBall(cut: string) {
  return [
    <circle key="ball" cx={cx} cy={cy} r={r} fill={MARK_BALL_COLOR} />,
    ...MARK_BALL_SEAMS.map(([x1, y1, x2, y2], i) => (
      <line
        key={`seam-${i}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={cut}
        strokeWidth={SEAM_WIDTH}
      />
    )),
    ...MARK_BALL_PATCHES.map((d, i) => (
      <path key={`patch-${i}`} d={d} fill={cut} />
    )),
    <polygon key="pentagon" points={MARK_BALL_PENTAGON} fill={cut} />,
  ];
}

/**
 * O símbolo em azul da marca, pro DOM (header e telas públicas). O azul é o `--primary` do
 * tema, no fundo e nos gomos da bola (`currentColor` sob o `text-primary` do `<g>`), então
 * acompanha claro/escuro. A cor fica no `<g>`, não no `<svg>`: assim uma classe de cor vinda
 * de quem usa (`text-white` num fundo azul, por exemplo) não apaga a trave. Decorativo, quem
 * dá nome é o texto ao lado.
 */
export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <g className="text-primary">
        <rect width="100" height="100" rx="22" fill="currentColor" />
        {markGlyph("currentColor")}
      </g>
    </svg>
  );
}
