import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Flat config only auto-ignores node_modules/ and .git/. `next lint` used to
  // skip build output, but `eslint .` does not — so a local build (or dev run)
  // leaves generated files on disk that `pnpm lint` then walks into. Ignore
  // them explicitly so lint covers source only and is stable regardless of
  // whether a build ran first. `.claude/` holds the agent harness's worktrees
  // (gitignored full-repo checkouts); linting those floods `pnpm lint` with
  // phantom errors from stale copies, so ignore the whole dir.
  {
    ignores: [
      ".next/",
      "out/",
      "build/",
      "coverage/",
      "next-env.d.ts",
      ".claude/",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Navegação rápida (#639, ADR 0067): todo link interno passa pelo IntentLink. O
  // prefetch automático do `next/link` guarda só o esqueleto de página dinâmica e
  // impede o cache do roteador de guardar a página inteira pra aquela URL.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["components/intent-link.tsx", "**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Use IntentLink (@/components/intent-link): sem prefetch automático, busca por intenção (ADR 0067).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
