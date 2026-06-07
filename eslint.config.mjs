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
  // whether a build ran first.
  { ignores: [".next/", "out/", "build/", "coverage/", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
