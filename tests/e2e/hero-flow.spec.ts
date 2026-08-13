import { expect, test, type Page, type Route } from "@playwright/test";

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
  relationLabel: null,
  relationState: null,
  hasOpenGap: true,
  evidenceCount: 12,
} as const;

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

async function installHeroApi(page: Page) {
  let confirmed = false;
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
    if (url.pathname === "/api/upload" && request.method() === "POST") {
      return json(route, {
        accepted: Array.from({ length: 10 }, (_, index) => ({
          id: `asset-${index + 1}`,
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
}

test("10 photos become a clarifiable, corrected and grounded memory", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installHeroApi(page);

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
  await page.getByRole("button", { name: "写真を安全に追加" }).click();
  await expect(page.getByText("受付 10件")).toBeVisible();

  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Memory Thread" }),
  ).toBeVisible();
  await expect(page.getByText(memory.title)).toBeVisible();
  await expect(page.getByText(/ひとつだけ確認したい/u)).toBeVisible();

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

test("an unconfigured production boundary reports an honest recoverable error", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Memoryを読み込めませんでした" }),
  ).toBeVisible();
  await expect(
    page.getByText("この環境では保存サービスがまだ設定されていません。"),
  ).toBeVisible();
});
