import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    // `.claude/` holds the agent harness's worktrees (gitignored full-repo
    // checkouts); without this, vitest walks into those stale copies and runs
    // their test files — hundreds of phantom failures. Keep the built-in
    // excludes (node_modules, dist, .git, …) via configDefaults.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
