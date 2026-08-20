import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const picker = source("src/components/rememory/place-picker.tsx");
const provider = source("src/server/places/provider.ts");
const complete = source("app/api/upload/complete/route.ts");
const upload = source("src/server/services/upload.ts");

describe("place picker end-to-end contract", () => {
  it("debounces two-character searches and caps public candidates", () => {
    expect(picker).toMatch(/normalized\.length < 2/u);
    expect(picker).toMatch(/window\.setTimeout\([\s\S]*?\}, 300\)/u);
    expect(picker).toMatch(/payload\.candidates\.slice\(0, 8\)/u);
    expect(provider).toMatch(/url\.searchParams\.set\("limit", "8"\)/u);
  });

  it("revalidates only the candidate ID on final upload", () => {
    expect(complete).toMatch(
      /placeCandidateId:[\s\S]*?resolveOptionalPlace\(input\.placeCandidateId\)/u,
    );
    expect(complete).not.toMatch(/placeLabel|coarseArea|mapCellId/u);
    expect(provider).toMatch(/providerId\(row\) !== candidateId/u);
  });

  it("keeps provider failure optional and never persists raw coordinates", () => {
    expect(complete).toMatch(
      /catch \{[\s\S]*?must never discard an otherwise valid photo upload[\s\S]*?return null/u,
    );
    expect(provider).toMatch(/latLngToCell\(latitude, longitude, 10\)/u);
    expect(upload).not.toMatch(/(?:latitude|longitude|\blat\b|\blng\b)\s*:/iu);
    expect(upload).toMatch(/source: "user_selected"/u);
  });
});
