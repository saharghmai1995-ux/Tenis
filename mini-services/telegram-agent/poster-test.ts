// ─── Poster engine test: renders all 9 kinds to poster-samples/*.png ────────
// Run: cd /home/z/my-project/mini-services/telegram-agent && bun poster-test.ts

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { registerFonts, renderPoster, samplePoster } from "./src/poster/engine";
import type { PosterKind } from "./src/types";

const KINDS: PosterKind[] = [
  "FLASHCARD",
  "FREECARD",
  "BRIEFING",
  "AGGREGATE",
  "WEEKLY",
  "NEWS",
  "ACADEMY",
  "BANNER",
  "FTRESULTS",
];

registerFonts();
mkdirSync("poster-samples", { recursive: true });

let failures = 0;
for (const kind of KINDS) {
  const t0 = performance.now();
  const res = renderPoster(samplePoster(kind));
  const dt = (performance.now() - t0).toFixed(0);

  if (!res.ok) {
    console.error(`FAIL  ${kind}: ${res.error}`);
    failures++;
    continue;
  }

  const path = `poster-samples/${kind}.png`;
  writeFileSync(path, Buffer.from(res.pngBase64, "base64"));
  const bytes = statSync(path).size;
  console.log(
    `OK    ${kind.padEnd(10)} ${res.width}x${res.height}  ${(bytes / 1024)
      .toFixed(1)
      .padStart(8)} KB  latinized=${String(res.latinized).padStart(3)}  ${dt}ms`,
  );

  if (bytes <= 50 * 1024) {
    console.error(`      !! ${kind} PNG too small (${bytes} bytes)`);
    failures++;
  }
}

// determinism check: same request must render pixel-identically
const a = renderPoster(samplePoster("FLASHCARD"));
const b = renderPoster(samplePoster("FLASHCARD"));
if (a.pngBase64 !== b.pngBase64) {
  console.error("FAIL  DETERMINISM: FLASHCARD rendered differently across runs");
  failures++;
} else {
  console.log("OK    DETERMINISM  FLASHCARD pixel-identical across runs");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nALL 9 POSTERS RENDERED OK");
