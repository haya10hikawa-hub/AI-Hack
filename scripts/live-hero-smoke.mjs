import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const required = [
  "LIVE_BASE_URL",
  "LIVE_HERO_EMAIL",
  "LIVE_HERO_PASSWORD",
  "LIVE_PHOTO_DIR",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`Missing live Hero configuration: ${missing.join(", ")}`);
}

const baseUrl = new URL(process.env.LIVE_BASE_URL).origin;
const photoDirectory = resolve(process.env.LIVE_PHOTO_DIR);
const timeoutMs = Number(process.env.LIVE_HERO_TIMEOUT_MS ?? 180_000);
const supported = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const photoNames = (await readdir(photoDirectory))
  .filter((name) =>
    supported.has(name.slice(name.lastIndexOf(".")).toLocaleLowerCase()),
  )
  .sort()
  .slice(0, 12);
if (photoNames.length < 1) {
  throw new Error("LIVE_PHOTO_DIR has no JPEG, PNG, or WebP images.");
}
const photos = photoNames.map((name) => resolve(photoDirectory, name));

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const context = await browser.newContext({
  baseURL: baseUrl,
  locale: "ja-JP",
  timezoneId: process.env.LIVE_TIMEZONE ?? "Asia/Tokyo",
});
const page = await context.newPage();
let memoryId = null;
const startedAt = Date.now();

try {
  await page.goto("/auth/login");
  await page.getByLabel("メールアドレス").fill(process.env.LIVE_HERO_EMAIL);
  await page.getByLabel("パスワード").fill(process.env.LIVE_HERO_PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/home$/u, { timeout: 30_000 });

  await page.goto("/add");
  await page.locator("#photo-input").setInputFiles(photos);
  if (process.env.LIVE_COARSE_PLACE?.trim()) {
    await page
      .getByLabel("おおまかな場所（任意）")
      .fill(process.env.LIVE_COARSE_PLACE.trim());
  }
  const uploadStartedAt = Date.now();
  await page.getByRole("button", { name: "写真を安全に追加" }).click();
  await page.getByText(/写真を保存しました|写真を安全に保存しました/u).waitFor({
    timeout: 60_000,
  });
  await page.getByRole("link", { name: "Memory Threadで状態を見る" }).click();

  const firstThread = await pollJson(
    page,
    "/api/memories?view=thread",
    (data) => Array.isArray(data?.memories) && data.memories.length > 0,
    timeoutMs,
  );
  const firstEventMs = Date.now() - uploadStartedAt;
  memoryId = firstThread.memories[0].id;

  const terminalThread = await pollJson(
    page,
    "/api/memories?view=thread",
    (data) =>
      Array.isArray(data?.memories) &&
      data.memories.some(
        (memory) =>
          memory.id === memoryId &&
          (memory.processingState === "ready" ||
            memory.processingState === "failed"),
      ),
    timeoutMs,
  );
  const terminalMemory = terminalThread.memories.find(
    (memory) => memory.id === memoryId,
  );
  if (terminalMemory?.processingState !== "ready") {
    throw new Error(
      `AI reconstruction ended as ${terminalMemory?.processingState ?? "unknown"}.`,
    );
  }
  const terminalMs = Date.now() - uploadStartedAt;

  const gapPayload = await pollJson(
    page,
    "/api/gaps?status=open",
    (data) => Array.isArray(data?.gaps) && data.gaps.length > 0,
    timeoutMs,
  );
  const gap = gapPayload.gaps[0];
  if (!gap?.id || !gap?.candidateLabel) {
    throw new Error("The live provider did not produce a confirmable gap.");
  }
  await browserJson(page, `/api/gaps/${encodeURIComponent(gap.id)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ decision: "confirm" }),
  });

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.LIVE_TIMEZONE ?? "Asia/Tokyo",
  }).format(new Date());
  const search = await browserJson(page, "/api/search", {
    method: "POST",
    body: JSON.stringify({
      query: gap.candidateLabel,
      currentDate: today,
      timezone: process.env.LIVE_TIMEZONE ?? "Asia/Tokyo",
    }),
  });
  if (search.answerState !== "grounded" || !search.answer) {
    throw new Error(`Re-query ended as ${search.answerState ?? "unknown"}.`);
  }
  if (!search.sources?.some((source) => source.kind === "user_correction")) {
    throw new Error("Grounded re-query did not cite the user correction.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        photos: photos.length,
        firstEventMs,
        terminalMs,
        totalMs: Date.now() - startedAt,
        performanceTargets: {
          firstEventWithin20Seconds: firstEventMs <= 20_000,
          terminalWithin35Seconds: terminalMs <= 35_000,
        },
        groundedSourceKinds: search.sources.map((source) => source.kind),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (memoryId !== null) {
    await browserJson(
      page,
      `/api/memories/${encodeURIComponent(memoryId)}/delete`,
      { method: "POST" },
    ).catch(() => undefined);
  }
  await context.close();
  await browser.close();
}

async function pollJson(page, path, predicate, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await browserJson(page, path);
    if (predicate(latest)) return latest;
    await page.waitForTimeout(2_000);
  }
  throw new Error(
    `Timed out waiting for ${path}; latest state: ${JSON.stringify(latest)}`,
  );
}

async function browserJson(page, path, init = {}) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        headers: {
          accept: "application/json",
          ...(requestInit.body ? { "content-type": "application/json" } : {}),
        },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload?.data ?? payload;
    },
    { requestPath: path, requestInit: init },
  );
}
