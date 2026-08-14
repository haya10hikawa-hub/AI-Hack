import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

async function mockAuthenticatedUser(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    json(route, {
      id: "33333333-3333-4333-8333-333333333333",
      email: "hero@example.com",
      displayName: "Hero Tester",
    }),
  );
}

test("legacy auth pages redirect into the accountless Memory Thread", async ({
  page,
}) => {
  await mockAuthenticatedUser(page);
  await page.route("**/api/memories?view=thread", (route) =>
    json(route, {
      memories: [],
      pendingConfirmationCount: 0,
      partial: false,
      partialMessage: null,
    }),
  );

  await page.goto("/auth/login");
  await expect(page).toHaveURL(/\/home$/u);
  await expect(
    page.getByRole("heading", { name: "最初のMemoryをつくりましょう" }),
  ).toBeVisible();

  for (const path of [
    "/auth/sign-up",
    "/auth/reset-password",
    "/auth/update-password",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/home$/u);
  }
});

test("privacy settings persist and public session reset returns home", async ({
  page,
}) => {
  const settings = {
    usePhotos: true,
    useCapturedAt: true,
    useLocation: false,
    useCalendar: false,
    usePersonalContext: true,
    searchLearning: true,
    locationPermissionState: "prompt",
    calendarConnectionState: "not_connected",
  } as const;
  const patchBodies: unknown[] = [];
  let signedOut = false;

  await mockAuthenticatedUser(page);
  await page.route("**/api/settings/privacy-ai", async (route) => {
    if (route.request().method() === "GET") return json(route, settings);
    const body = route.request().postDataJSON() as Record<string, boolean>;
    patchBodies.push(body);
    return json(route, { ...settings, ...body });
  });
  await page.route("**/api/auth/sign-out", (route) => {
    signedOut = true;
    return json(route, { authenticated: false });
  });

  await page.goto("/settings/privacy-ai");
  const locationToggle = page.getByRole("switch", {
    name: /おおまかな場所を使う/u,
  });
  await expect(locationToggle).toHaveAttribute("aria-checked", "false");
  await locationToggle.click();
  await expect(page.getByText("設定を保存しました。")).toBeVisible();
  await expect(locationToggle).toHaveAttribute("aria-checked", "true");
  expect(patchBodies).toContainEqual({ useLocation: true });

  const learningToggle = page.getByRole("switch", {
    name: /検索結果をあなた向けに学習/u,
  });
  await learningToggle.click();
  await expect(learningToggle).toHaveAttribute("aria-checked", "false");
  expect(patchBodies).toContainEqual({ searchLearning: false });

  await page.getByRole("button", { name: "公開セッションをリセット" }).click();
  await expect(page).toHaveURL(/\/home$/u);
  expect(signedOut).toBe(true);
});

test("partial Memory keeps its provenance visible and can be deleted", async ({
  page,
}) => {
  const memoryId = "11111111-1111-4111-8111-111111111111";
  let deleteRequests = 0;
  await mockAuthenticatedUser(page);
  await page.route(`**/api/memories/${memoryId}`, (route) =>
    json(route, {
      memory: {
        id: memoryId,
        title: "2026年4月12日の記憶",
        capturedAt: "2026-04-12T09:00:00+09:00",
        placeLabel: null,
        photoCount: 2,
        representativeImageUrl: null,
        representativeImageAlt: null,
        state: "evidence",
        processingState: "partial",
        summary: "写真と撮影情報から作成したMemoryです。",
        hasOpenGap: false,
        evidenceCount: 2,
      },
      reconstruction: null,
      claims: [
        {
          id: "claim-1",
          text: "time: 2026-04-12T09:00:00+09:00",
          state: "evidence",
          origin: "deterministic",
          evidenceIds: ["evidence-1"],
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          label: "captured_at",
          detail: "2026-04-12T09:00:00+09:00",
          kind: "metadata",
          sourceLabel: "metadata",
        },
      ],
      partial: true,
      partialMessage:
        "決定的なEvidenceは保存済みですが、AI再構成はまだ完了していません。",
    }),
  );
  await page.route(`**/api/memories/${memoryId}/delete`, (route) => {
    deleteRequests += 1;
    return json(route, {
      deleted: true,
      message: "Memoryを削除しました。",
    });
  });

  await page.goto(`/memories/${memoryId}`);
  await expect(
    page.getByText(
      "決定的なEvidenceは保存済みですが、AI再構成はまだ完了していません。",
    ),
  ).toBeVisible();
  await page.getByText("このMemoryの根拠").click();
  await expect(page.getByText("captured_at", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByText("本当に削除しますか？")).toBeVisible();
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(
    page.getByRole("heading", { name: "Memoryを削除しました" }),
  ).toBeVisible();
  expect(deleteRequests).toBe(1);
});

test("failed AI reconstruction can resume without re-uploading photos", async ({
  page,
}) => {
  const memoryId = "11111111-1111-4111-8111-111111111111";
  let retryBody: unknown = null;
  await mockAuthenticatedUser(page);
  await page.route(`**/api/memories/${memoryId}`, (route) =>
    json(route, {
      memory: {
        id: memoryId,
        title: "2026年4月12日の記憶",
        capturedAt: "2026-04-12T09:00:00+09:00",
        placeLabel: "神山",
        photoCount: 10,
        representativeImageUrl: null,
        state: "evidence",
        processingState: "failed",
        hasOpenGap: false,
        evidenceCount: 2,
      },
      reconstruction: null,
      claims: [],
      evidence: [],
      partial: true,
      partialMessage:
        "決定的なEvidenceは保存済みです。AI再構成は保存済みの途中結果から再試行できます。",
    }),
  );
  await page.route("**/api/analysis/retry", (route) => {
    retryBody = route.request().postDataJSON();
    return json(route, {
      retryRequested: 1,
      processing: {
        claimed: 1,
        completed: 0,
        retryScheduled: 0,
        dead: 0,
      },
    });
  });

  await page.goto(`/memories/${memoryId}`);
  await expect(
    page.getByText("保存済みの写真をもう一度選ぶ必要はありません。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI再構成を再試行" }).click();
  await expect(page.getByText("AI再構成を再開しました。")).toBeVisible();
  expect(retryBody).toEqual({ memoryId });
});

test("choosing later explains when the Memory question will return", async ({
  page,
}) => {
  const gapId = "22222222-2222-4222-8222-222222222222";
  let decision: unknown = null;
  await mockAuthenticatedUser(page);
  await page.route("**/api/gaps?status=open", (route) =>
    json(route, {
      gaps: [
        {
          id: gapId,
          memoryId: "11111111-1111-4111-8111-111111111111",
          memoryTitle: "神山でのロボット制作",
          question: "これはFTCの練習でしたか？",
          candidateLabel: "FTCの練習",
          evidenceSummary: "ロボットを調整している写真があります。",
          state: "open",
        },
      ],
    }),
  );
  await page.route(`**/api/gaps/${gapId}/confirm`, (route) => {
    decision = route.request().postDataJSON();
    return json(route, {
      saved: true,
      deferred: true,
      deferredUntil: "2026-08-15T00:00:00.000Z",
      createdClaimId: null,
    });
  });

  await page.goto("/confirm");
  await page.getByRole("button", { name: "あとで" }).click();
  await expect(
    page.getByText("この質問は24時間後にもう一度表示します"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "いま確認が必要なMemoryはありません",
    }),
  ).toBeVisible();
  expect(decision).toEqual({ decision: "later" });
});
