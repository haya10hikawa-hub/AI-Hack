import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function routeSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const gapConfirm = routeSource("app/api/gaps/[id]/confirm/route.ts");
const deletion = routeSource("app/api/memories/[id]/delete/route.ts");
const upload = routeSource("app/api/upload/route.ts");
const search = routeSource("app/api/search/route.ts");

describe("API route implementation contracts", () => {
  it("confirms a gap through the gap-aware atomic RPC", () => {
    expect(gapConfirm).toMatch(
      /database\.rpc\(\s*"apply_memory_gap_correction",\s*\{[\s\S]*?p_user_id:\s*user\.id,[\s\S]*?p_gap_id:\s*gapId,[\s\S]*?p_action:\s*action,[\s\S]*?p_value_json:\s*value,[\s\S]*?p_field:\s*gapResult\.data\.dimension,[\s\S]*?p_idempotency_key:\s*idempotencyKey,[\s\S]*?\}\s*\)/u,
    );
    expect(gapConfirm).not.toMatch(
      /database\.rpc\(\s*"apply_user_correction"/u,
    );
    expect(gapConfirm).toMatch(
      /stableUuidFromRequest\(\s*user\.id,\s*gapId,\s*action,\s*value,?\s*\)/u,
    );
  });

  it("keeps deletion retryable and idempotent around storage cleanup", () => {
    expect(deletion).toMatch(
      /if \(owned\.data === null\)[\s\S]*?deleted:\s*true,\s*idempotent:\s*true/u,
    );
    expect(deletion).toMatch(
      /if \(owned\.data\.status === "deleted"\)[\s\S]*?deleted:\s*true,\s*idempotent:\s*true/u,
    );
    expect(deletion).toMatch(
      /if \(owned\.data\.status !== "deleting"\)[\s\S]*?database\.rpc\(\s*"request_memory_deletion"/u,
    );

    const storageRemoval = deletion.indexOf(".remove(storageKeys)");
    const finalization = deletion.indexOf(
      'database.rpc("finalize_memory_deletion"',
    );
    expect(storageRemoval).toBeGreaterThan(-1);
    expect(finalization).toBeGreaterThan(storageRemoval);
    expect(deletion).toMatch(
      /finalized\.data !== true[\s\S]*?remaining\.data !== null[\s\S]*?deleted:\s*true,\s*idempotent:\s*true/u,
    );
  });

  it("schedules background analysis and records a terminal state after taking a lease", () => {
    const lease = upload.indexOf('database.rpc("claim_sequence_analysis"');
    const analysis = upload.indexOf("await analyzePersistedSequence(");
    const complete = upload.indexOf('p_status: "complete"');
    const failed = upload.indexOf('p_status: "failed"');

    expect(lease).toBeGreaterThan(-1);
    expect(analysis).toBeGreaterThan(lease);
    expect(complete).toBeGreaterThan(analysis);
    expect(failed).toBeGreaterThan(complete);
    expect(upload).toMatch(
      /after\(\(\) =>\s*processSequences\(\{[\s\S]*?sequences:\s*result\.sequences/u,
    );
    expect(upload).toMatch(
      /lease\.error !== null \|\| lease\.data !== true\) return;[\s\S]*?try \{[\s\S]*?p_status:\s*"complete"[\s\S]*?catch[\s\S]*?p_status:\s*"failed"/u,
    );
    expect(upload).toMatch(/processingState:\s*result\.processingState/u);
  });

  it("grounds displayed search sources in claim ids selected by the answer", () => {
    expect(search).toMatch(
      /const citedIds = new Set\([\s\S]*?answered\.data\.segments\.flatMap\(\(\{ claimIds \}\) => claimIds\)[\s\S]*?\)/u,
    );
    expect(search).toMatch(
      /sources:\s*grounded\.facts[\s\S]*?filter\(\(\{ claimId \}\) => citedIds\.has\(claimId\)\)[\s\S]*?kind:\s*fact\.provenance\.kind/u,
    );
  });
});
