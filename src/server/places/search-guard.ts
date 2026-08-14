import "server-only";

import type { PlaceCandidate } from "@/src/domain/place";

import type { PlaceProvider } from "./provider";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;

const requestsByUser = new Map<string, number[]>();
const queryCache = new Map<
  string,
  { expiresAt: number; candidates: PlaceCandidate[] }
>();

export class PlaceSearchRateLimitError extends Error {
  constructor() {
    super("Place search rate limit exceeded.");
    this.name = "PlaceSearchRateLimitError";
  }
}

export async function guardedPlaceSearch(input: {
  userId: string;
  query: string;
  provider: PlaceProvider;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const cached = queryCache.get(input.query);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.candidates;
  }

  const recent = (requestsByUser.get(input.userId) ?? []).filter(
    (timestamp) => timestamp > now - WINDOW_MS,
  );
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    requestsByUser.set(input.userId, recent);
    throw new PlaceSearchRateLimitError();
  }
  recent.push(now);
  requestsByUser.set(input.userId, recent);

  const candidates = await input.provider.search(input.query);
  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(input.query, {
    expiresAt: now + CACHE_TTL_MS,
    candidates,
  });
  return candidates;
}

export function resetPlaceSearchGuardForTests() {
  requestsByUser.clear();
  queryCache.clear();
}
