import { expect, test, type Page, type Route } from "@playwright/test";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const memory = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "神山でのロボット制作",
  capturedAt: "2026-04-12T09:00:00+09:00",
  placeLabel: "神山",
  photoCount: 10,
  representativeImageUrl: null,
  representativeImageAlt: null,
  state: "inferred",
  processingState: "ready",
  summary: "写真にはロボットを調整している様子が写っています。",
  relationLabel: "「初めての試作」と同じ活動",
  relationState: "confirmed",
  hasOpenGap: true,
  evidenceCount: 12,
} as const;

const relatedMemory = {
  memoryId: "44444444-4444-4444-8444-444444444444",
  title: "初めての試作",
  capturedAt: "2026-03-20T09:00:00+09:00",
  relationType: "before",
  relationState: "confirmed",
  representativeImageUrl: pixel,
} as const;

type DetailRepresentatives = {
  identity: { assetId: string; imageUrl: string; alt: string } | null;
  keyMoment: { assetId: string; imageUrl: string; alt: string } | null;
  complement: { assetId: string; imageUrl: string; alt: string } | null;
};

const representatives: DetailRepresentatives = {
  identity: { assetId: "asset-1", imageUrl: pixel, alt: "制作の全景" },
  keyMoment: { assetId: "asset-5", imageUrl: pixel, alt: "調整中の場面" },
  complement: { assetId: "asset-9", imageUrl: pixel, alt: "別角度の場面" },
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

interface HeroApiObservations {
  preparedFiles: Array<{
    name: string;
    mimeType: string;
    bytes: number;
  }>;
  signedUploads: Array<{ path: string; token: string; method: string }>;
  completion: {
    manifest: string;
    timezoneOffsetMinutes: number;
    timezone: string;
    coarsePlace: string | null;
  } | null;
}

async function installHeroApi(
  page: Page,
  detail: {
    representatives?: DetailRepresentatives;
    relatedMemories?: (typeof relatedMemory)[];
  } = {},
): Promise<HeroApiObservations> {
  let confirmed = false;
  const observations: HeroApiObservations = {
    preparedFiles: [],
    signedUploads: [],
    completion: null,
  };

  await page.route(
    /\/storage\/v1\/object\/upload\/sign\/rememory-private\//u,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const marker = "/storage/v1/object/upload/sign/rememory-private/";
      const encodedPath = url.pathname.slice(
        url.pathname.indexOf(marker) + marker.length,
      );
      observations.signedUploads.push({
        path: decodeURIComponent(encodedPath),
        token: url.searchParams.get("token") ?? "",
        method: request.method(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          Key: `rememory-private/${decodeURIComponent(encodedPath)}`,
        }),
      });
    },
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/me" && request.method() === "GET") {
      return json(route, {
        user: {
          id: "33333333-3333-4333-8333-333333333333",
          email: "hero@example.com",
          displayName: "Hero Tester",
        },
      });
    }
    if (url.pathname === "/api/upload/prepare" && request.method() === "POST") {
      const input = request.postDataJSON() as {
        files: HeroApiObservations["preparedFiles"];
      };
      observations.preparedFiles = input.files;
      return json(route, {
        manifest: "hero-upload-manifest",
        uploads: input.files.map((_, index) => ({
          clientIndex: index,
          slotId: `slot-${index + 1}`,
          path: `preview-user/staging/hero-upload/slot-${index + 1}`,
          token: `signed-token-${index + 1}`,
        })),
      });
    }
    if (
      url.pathname === "/api/upload/complete" &&
      request.method() === "POST"
    ) {
      observations.completion =
        request.postDataJSON() as HeroApiObservations["completion"];
      return json(route, {
        accepted: Array.from({ length: 10 }, (_, index) => ({
          id: `asset-${index + 1}`,
          slotId: `slot-${index + 1}`,
          name: `photo-${index + 1}.png`,
          capturedAt: "2026-04-12T09:00:00+09:00",
          state: "processing",
        })),
        rejected: [],
        sequenceIds: ["sequence-1"],
        processingState: "processing",
        message: "写真と確定的なEvidenceを保存しました。",
      });
    }
    if (url.pathname === "/api/memories" && request.method() === "GET") {
      return json(route, {
        memories: [
          {
            ...memory,
            state: confirmed ? "confirmed" : "inferred",
            hasOpenGap: !confirmed,
          },
        ],
        pendingConfirmationCount: confirmed ? 0 : 1,
        partial: false,
        partialMessage: null,
      });
    }
    if (
      url.pathname === `/api/memories/${memory.id}` &&
      request.method() === "GET"
    ) {
      return json(route, {
        memory: {
          ...memory,
          state: confirmed ? "confirmed" : "inferred",
          updatedAt: "2026-04-12T12:00:00+09:00",
        },
        representatives: detail.representatives ?? representatives,
        relatedMemories: detail.relatedMemories ?? [relatedMemory],
        reconstruction: memory.summary,
        claims: confirmed
          ? [
              {
                id: "user-claim",
                text: "目的: FTCの練習",
                state: "confirmed",
                origin: "user",
                evidenceIds: [],
              },
            ]
          : [
              {
                id: "ai-claim",
                text: "活動: ロボット調整",
                state: "inferred",
                origin: "ai",
                evidenceIds: ["evidence-1"],
              },
            ],
        evidence: [
          {
            id: "evidence-1",
            label: "撮影日時",
            detail: "2026/04/12",
            kind: "metadata",
            sourceLabel: "metadata",
          },
        ],
        partial: false,
        partialMessage: null,
      });
    }
    if (url.pathname === "/api/gaps" && request.method() === "GET") {
      return json(route, {
        gaps: confirmed
          ? []
          : [
              {
                id: "22222222-2222-4222-8222-222222222222",
                memoryId: memory.id,
                memoryTitle: memory.title,
                question: "これはFTCの練習でしたか？",
                candidateLabel: "FTCの練習",
                evidenceSummary:
                  "写真にはロボットを調整している様子があります。理由は未確認です。",
                state: "open",
              },
            ],
      });
    }
    if (url.pathname.endsWith("/confirm") && request.method() === "POST") {
      confirmed = true;
      return json(route, { saved: true, createdClaimId: "user-claim" });
    }
    if (url.pathname === "/api/search" && request.method() === "POST") {
      return confirmed
        ? json(route, {
            interpretation: {
              time: "2026年4月12日",
              place: "神山",
              activities: ["FTCの練習"],
              keywords: [],
            },
            answer: "2026年4月12日は、神山でFTCの練習をしていました。",
            answerState: "grounded",
            candidates: [
              {
                memory: { ...memory, state: "confirmed", hasOpenGap: false },
                matchReasons: ["撮影日時が一致", "あなたの確認が一致"],
              },
            ],
            sources: [
              {
                claimId: "user-claim",
                label: "FTCの練習",
                kind: "user_correction",
              },
            ],
            clarification: null,
          })
        : json(route, {
            interpretation: {
              time: "2026年4月12日",
              place: "神山",
              activities: [],
              keywords: [],
            },
            answer: null,
            answerState: "clarification",
            candidates: [
              { memory, matchReasons: ["撮影日時が一致", "場所が一致"] },
            ],
            sources: [],
            clarification:
              "写真から理由までは確認できません。FTCの練習ですか？",
          });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "TEST_ROUTE_MISSING", message: url.pathname },
      }),
    });
  });
  return observations;
}

test("10 photos become a clarifiable, corrected and grounded memory", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const observations = await installHeroApi(page);

  await page.goto("/add");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("input[type=file]").setInputFiles(
    Array.from({ length: 10 }, (_, index) => ({
      name: `photo-${index + 1}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await expect(page.getByText("選択中の写真")).toBeVisible();
  await page.getByLabel("おおまかな場所（任意）").fill("神山");
  await page.getByRole("button", { name: "写真を安全に追加" }).click();
  await expect(page.getByText("受付 10件")).toBeVisible();
  await expect(page.getByText("選択中の写真")).toHaveCount(0);

  expect(observations.preparedFiles).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      name: `photo-${index + 1}.png`,
      mimeType: "image/png",
      bytes: png.length,
    })),
  );
  expect(observations.signedUploads).toHaveLength(10);
  expect(
    observations.signedUploads
      .map(({ path, token, method }) => ({ path, token, method }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  ).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      path: `preview-user/staging/hero-upload/slot-${index + 1}`,
      token: `signed-token-${index + 1}`,
      method: "PUT",
    })).sort((left, right) => left.path.localeCompare(right.path)),
  );
  expect(observations.completion).toMatchObject({
    manifest: "hero-upload-manifest",
    coarsePlace: "神山",
  });
  expect(observations.completion?.timezoneOffsetMinutes).toEqual(
    expect.any(Number),
  );
  expect(observations.completion?.timezone).toEqual(expect.any(String));

  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Memory Thread" }),
  ).toBeVisible();
  await expect(page.getByText(memory.title)).toBeVisible();
  await expect(page.getByText(/ひとつだけ確認したい/u)).toBeVisible();

  await page.goto(`/memories/${memory.id}`);
  await expect(page.getByLabel("Memoryの写真").locator("img")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "この記憶につながる瞬間" }),
  ).toBeVisible();
  await expect(page.getByText("このMemoryより前")).toBeVisible();
  await expect(page.getByText(relatedMemory.title)).toBeVisible();

  await page.goto("/search");
  await page
    .getByLabel("思い出したいこと")
    .fill("この日は何してた？なんで神山にいたの？");
  await page.getByRole("button", { name: "検索" }).click();
  await expect(
    page.getByText("写真から理由までは確認できません。FTCの練習ですか？"),
  ).toBeVisible();

  await page.goto("/confirm");
  await expect(
    page.getByRole("heading", { name: "これはFTCの練習でしたか？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "そう" }).click();
  await expect(page.getByText("確認を保存しました")).toBeVisible();

  await page.goto("/search");
  await page.getByLabel("思い出したいこと").fill("なんで神山にいたの？");
  await page.getByRole("button", { name: "検索" }).click();
  await expect(
    page.getByText("2026年4月12日は、神山でFTCの練習をしていました。"),
  ).toBeVisible();
  await page.getByText("回答の根拠を表示").click();
  await expect(page.getByText("FTCの練習 · あなたの確認")).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("processing refresh keeps the Memory list and expansion state visible", async ({
  page,
}) => {
  let analysisRequests = 0;
  let backgroundRefreshRequests = 0;
  let releaseRefresh: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/memories" && request.method() === "GET") {
      const processing = analysisRequests === 0;
      if (!processing) {
        backgroundRefreshRequests += 1;
        await refreshGate;
      }
      return json(route, {
        memories: [
          {
            ...memory,
            processingState: processing ? "processing" : "ready",
          },
        ],
        pendingConfirmationCount: 0,
        partial: processing,
        partialMessage: processing
          ? "写真は保存済みです。AIによる再構成を続けています。"
          : null,
      });
    }
    if (
      url.pathname === "/api/analysis/process" &&
      request.method() === "POST"
    ) {
      analysisRequests += 1;
      return json(route, {
        claimed: 1,
        completed: 1,
        retryScheduled: 0,
        dead: 0,
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "TEST_ROUTE_MISSING", message: url.pathname },
      }),
    });
  });

  await page.goto("/home");
  const memoryToggle = page.getByRole("button", {
    name: new RegExp(memory.title),
  });
  await expect(memoryToggle).toBeVisible();
  await memoryToggle.click();
  await expect(memoryToggle).toHaveAttribute("aria-expanded", "false");

  await expect
    .poll(() => backgroundRefreshRequests, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText(memory.title)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Memoryを読み込んでいます" }),
  ).toHaveCount(0);
  await expect(memoryToggle).toHaveAttribute("aria-expanded", "false");

  releaseRefresh?.();
  await expect(page.getByText("写真を保存済み・AI再構成中")).toHaveCount(0);
  await expect(memoryToggle).toHaveAttribute("aria-expanded", "false");
});

test("AI failure keeps the deterministic Memory usable", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") {
      return json(route, {
        user: { id: "user-a", email: "hero@example.com" },
      });
    }
    if (url.pathname === "/api/memories") {
      return json(route, {
        memories: [
          {
            ...memory,
            title: "保存済みのMemory",
            representativeImageUrl: null,
            processingState: "failed",
            relationLabel: null,
            relationState: null,
          },
        ],
        pendingConfirmationCount: 0,
        partial: true,
        partialMessage:
          "写真と確定的な情報は保存済みです。AI再構成は未完了です。",
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto("/home");
  await expect(page.getByText("保存済みのMemory")).toBeVisible();
  await expect(page.getByText(/写真と確定的な情報は保存済み/u)).toBeVisible();
});

test("Memory Space falls back for one or two representative photos", async ({
  page,
}) => {
  await installHeroApi(page, {
    representatives: { ...representatives, complement: null },
    relatedMemories: [],
  });
  await page.goto(`/memories/${memory.id}`);
  await expect(page.getByLabel("Memoryの写真").locator("img")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "この記憶につながる瞬間" }),
  ).toHaveCount(0);
});

test("Memory Space promotes the only remaining representative", async ({
  page,
}) => {
  await installHeroApi(page, {
    representatives: {
      identity: null,
      keyMoment: representatives.keyMoment,
      complement: null,
    },
    relatedMemories: [],
  });
  await page.goto(`/memories/${memory.id}`);
  await expect(page.getByLabel("Memoryの写真").locator("img")).toHaveCount(1);
});

test("Memory Space remains usable without a representative photo", async ({
  page,
}) => {
  await installHeroApi(page, {
    representatives: { identity: null, keyMoment: null, complement: null },
    relatedMemories: [],
  });
  await page.goto(`/memories/${memory.id}`);
  await expect(page.getByText("表示できる代表写真はありません")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "この日にあったこと" }),
  ).toBeVisible();
});

test("an unconfigured production boundary reports an honest recoverable error", async ({
  page,
}) => {
  await page.route("**/api/memories?view=thread", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "CONFIGURATION_ERROR",
          message: "この環境では保存サービスがまだ設定されていません。",
        },
      }),
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Memoryを読み込めませんでした" }),
  ).toBeVisible();
  await expect(
    page.getByText("この環境では保存サービスがまだ設定されていません。"),
  ).toBeVisible();
});
