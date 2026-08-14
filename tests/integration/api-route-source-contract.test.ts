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
const analysisJobs = routeSource("src/server/services/analysis-jobs.ts");
const analysisWorker = routeSource("app/api/internal/analysis-worker/route.ts");
const analysisResume = routeSource("app/api/analysis/process/route.ts");
const analysisRetry = routeSource("app/api/analysis/retry/route.ts");
const analysisPipeline = routeSource(
  "src/server/services/analysis-pipeline.ts",
);
const search = routeSource("app/api/search/route.ts");
const memoryMap = routeSource("app/api/map/route.ts");
const health = routeSource("app/api/health/route.ts");

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

  it("persists analysis work before responding and leaves after as a fast-path", () => {
    const enqueue = upload.indexOf("await enqueueSequenceAnalysisJobs(");
    const backgroundKick = upload.indexOf("after(() =>");
    const response = upload.indexOf("return dataResponse({");

    expect(enqueue).toBeGreaterThan(-1);
    expect(backgroundKick).toBeGreaterThan(enqueue);
    expect(response).toBeGreaterThan(backgroundKick);
    expect(upload).toMatch(
      /await enqueueSequenceAnalysisJobs\(\{[\s\S]*?sequences:\s*result\.sequences/u,
    );
    expect(upload).toMatch(
      /after\(\(\) =>\s*processAnalysisJobs\(\{[\s\S]*?maxJobs:\s*1/u,
    );
    expect(upload).toMatch(/processingState:\s*result\.processingState/u);
  });

  it("claims, heartbeats, and finishes durable jobs through server-only RPCs", () => {
    const claim = analysisJobs.indexOf(
      'database.rpc("claim_sequence_analysis_job"',
    );
    const analysis = analysisJobs.indexOf("await analyzePersistedSequence(");
    const heartbeat = analysisJobs.indexOf(
      'database.rpc("touch_sequence_analysis_job"',
    );
    const finish = analysisJobs.indexOf(
      'database.rpc("finish_sequence_analysis_job"',
    );

    expect(claim).toBeGreaterThan(-1);
    expect(analysis).toBeGreaterThan(claim);
    expect(heartbeat).toBeGreaterThan(analysis);
    expect(finish).toBeGreaterThan(heartbeat);
    expect(analysisJobs).toMatch(
      /retryDelaySeconds\(input\.job\.attemptCount\)/u,
    );
    expect(analysisJobs).toMatch(/download\(asset\.derivative_storage_key\)/u);
    expect(analysisJobs).toMatch(/resumeFrom:\s*input\.job\.stage/u);
    expect(analysisPipeline).toMatch(
      /if \(resumeFrom === "analysis"\)[\s\S]*?provider\.analyzeSequence/u,
    );
    expect(analysisPipeline).toMatch(
      /if \(resumeFrom !== "gap"\)[\s\S]*?provider\.generateEventClaims/u,
    );
  });

  it("protects the scheduled worker with a server-only bearer secret", () => {
    expect(analysisWorker).toMatch(/process\.env\.CRON_SECRET/u);
    expect(analysisWorker).toMatch(/timingSafeEqual/u);
    expect(analysisWorker).toMatch(/await processAnalysisJobs\(/u);
    expect(analysisWorker).not.toMatch(/requireAuthenticatedUser/u);
  });

  it("scopes interactive job recovery to the verified session owner", () => {
    expect(analysisResume).toMatch(/assertSameOrigin\(request\)/u);
    expect(analysisResume).toMatch(/requireAuthenticatedUser\(\)/u);
    expect(analysisResume).toMatch(/userId:\s*user\.id/u);
    expect(analysisResume).not.toMatch(/request\.json\(\)/u);
  });

  it("lets an owner explicitly retry only failed or waiting analysis", () => {
    expect(analysisRetry).toMatch(/assertSameOrigin\(request\)/u);
    expect(analysisRetry).toMatch(/requireAuthenticatedUser\(\)/u);
    expect(analysisRetry).toMatch(
      /\.eq\("user_id", user\.id\)[\s\S]*?\.in\("status", \["dead", "retry_wait"\]\)/u,
    );
    expect(analysisRetry).toMatch(
      /p_user_id:\s*user\.id,[\s\S]*?p_sequence_id:\s*job\.sequence_id,[\s\S]*?p_memory_id:\s*job\.memory_id/u,
    );
  });

  it("grounds displayed search sources in claim ids selected by the answer", () => {
    expect(search).toMatch(
      /const citedIds = new Set\([\s\S]*?answered\.data\.segments\.flatMap\(\(\{ claimIds \}\) => claimIds\)[\s\S]*?\)/u,
    );
    expect(search).toMatch(
      /sources:\s*grounded\.facts[\s\S]*?filter\(\(\{ claimId \}\) => citedIds\.has\(claimId\)\)[\s\S]*?kind:\s*fact\.provenance\.kind/u,
    );
  });

  it("accepts only privacy-safe Map cells and scopes every mutation to the session owner", () => {
    expect(memoryMap).toMatch(/\.strict\(\)/u);
    expect(memoryMap).toMatch(/refine\(isAllowedMemoryMapCell\)/u);
    expect(memoryMap).toMatch(/assertSameOrigin\(request\)/u);
    expect(memoryMap).toMatch(/requireAuthenticatedUser\(\)/u);
    expect(memoryMap).toMatch(
      /p_user_id:\s*user\.id,[\s\S]*?p_cell_id:\s*input\.cellId/u,
    );
    expect(memoryMap).toMatch(
      /\.delete\(\)[\s\S]*?\.eq\("user_id", user\.id\)/u,
    );
    expect(memoryMap).not.toMatch(/input\.(?:latitude|longitude)/u);
  });

  it("uses an owned Map cell as a deterministic Search candidate scope", () => {
    expect(search).toMatch(/refine\(isAllowedMemoryMapCell\)/u);
    expect(search).toMatch(
      /from\("memory_map_cells"\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("cell_id", input\.cellId\)/u,
    );
    expect(search).toMatch(
      /from\("memory_map_cell_memories"\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("cell_id", input\.cellId\)/u,
    );
    expect(search).toMatch(/memoryQuery\.in\(\s*"id"/u);
    expect(search).not.toMatch(/userId:\s*input/u);
    expect(search).not.toMatch(/(?:latitude|longitude).*input\./u);
  });

  it("requires every configured AI model role before reporting healthy", () => {
    for (const name of [
      "AI_MODEL_VISION_CHEAP",
      "AI_MODEL_EVENT_CHEAP",
      "AI_MODEL_CHAT_CHEAP",
      "AI_MODEL_EVENT_STRONG",
    ]) {
      expect(health).toContain(`process.env.${name}`);
    }
  });
});
