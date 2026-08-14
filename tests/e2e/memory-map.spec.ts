import { expect, test, type Page, type Route } from "@playwright/test";

const cellId = "8a2e6e82175ffff";
const memoryId = "11111111-1111-4111-8111-111111111111";

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
      email: "map@example.com",
      displayName: "Map Tester",
    }),
  );
}

const emptyMap = {
  enabled: true,
  cells: [],
  coarseAreas: [],
  partial: false,
  partialMessage: null,
};

const revealedMap = {
  ...emptyMap,
  cells: [
    {
      cellId,
      state: "memory",
      firstSeenAt: "2026-08-14T09:00:00.000Z",
      lastSeenAt: "2026-08-14T09:00:00.000Z",
      visitCount: 2,
      dwellBucket: null,
      evidenceCount: 1,
      memoryCount: 1,
      coarsePlace: "神山周辺",
      memories: [
        {
          id: memoryId,
          title: "FTC練習",
          updatedAt: "2026-08-14T09:00:00.000Z",
        },
      ],
    },
  ],
};

test("Memory Map reveals only a privacy-safe cell and opens a real Memory", async ({
  page,
}) => {
  let revealed = false;
  let revealBody: unknown = null;
  await mockAuthenticatedUser(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 35,
              longitude: 135,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  await page.route("**/api/map", async (route) => {
    if (route.request().method() === "GET") {
      return json(route, revealed ? revealedMap : emptyMap);
    }
    if (route.request().method() === "POST") {
      revealBody = route.request().postDataJSON();
      revealed = true;
      return json(route, { revealed: true, cellId });
    }
    return route.fallback();
  });
  await page.route(`**/api/memories/${memoryId}`, (route) =>
    json(route, {
      memory: {
        id: memoryId,
        title: "FTC練習",
        capturedAt: "2026-08-14T09:00:00.000Z",
        placeLabel: "神山周辺",
        photoCount: 2,
        representativeImageUrl: null,
        state: "confirmed",
        processingState: "ready",
      },
      reconstruction: null,
      claims: [],
      evidence: [],
      partial: false,
    }),
  );

  await page.goto("/map");
  await expect(
    page.getByRole("heading", { name: "まだ地図に記憶がありません" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "現在地を使う" }).click();
  await expect(
    page.getByText(
      "現在いる地域をひらきました。正確な位置情報は保存していません。",
    ),
  ).toBeVisible();
  expect(revealBody).toEqual({ cellId });
  expect(JSON.stringify(revealBody)).not.toMatch(
    /latitude|longitude|accuracy/u,
  );

  await expect(page.getByRole("heading", { name: "神山周辺" })).toBeVisible();
  await page.getByRole("link", { name: /FTC練習/u }).click();
  await expect(page).toHaveURL(new RegExp(`/memories/${memoryId}$`, "u"));
  await expect(page.getByRole("heading", { name: "FTC練習" })).toBeVisible();
});

test("permission denial keeps saved Map data usable and clearing preserves Memories", async ({
  page,
}) => {
  let cleared = false;
  await mockAuthenticatedUser(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          _success: PositionCallback,
          error?: PositionErrorCallback,
        ) {
          error?.({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
      },
    });
  });
  await page.route("**/api/map", async (route) => {
    if (route.request().method() === "DELETE") {
      cleared = true;
      return json(route, { cleared: true });
    }
    return json(route, cleared ? emptyMap : revealedMap);
  });

  await page.goto("/map");
  await page.getByRole("button", { name: "現在地を使う" }).click();
  await expect(page.getByText(/位置情報が許可されませんでした/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "神山周辺" })).toBeVisible();

  await page.getByRole("button", { name: "地図だけ消去" }).click();
  await expect(
    page.getByText("探索した地図を消去しました。Memoryは削除されていません。"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "まだ地図に記憶がありません" }),
  ).toBeVisible();
});
