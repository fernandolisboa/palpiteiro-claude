import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRAND_ASSETS_DIR, renderBrandAssets } from "./brand-assets";

// `pnpm brand:export`: regrava os arquivos da marca em docs/brand/ a partir da geometria do
// app. Rodar depois de qualquer mudança em components/brand/.
async function main() {
  mkdirSync(BRAND_ASSETS_DIR, { recursive: true });
  for (const { file, bytes } of await renderBrandAssets()) {
    writeFileSync(join(BRAND_ASSETS_DIR, file), bytes);
    console.log(`${BRAND_ASSETS_DIR}/${file} (${bytes.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
