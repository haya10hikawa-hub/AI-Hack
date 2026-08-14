import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { coarseLocationCenter, type CoarseLocation } from "@/src/domain/exif";

export async function resolveCoarseLocationLabel(input: {
  database: SupabaseClient;
  location: CoarseLocation;
  fetchImplementation?: typeof fetch;
}): Promise<string | null> {
  const endpoint = process.env.GEOCODER_API_BASE_URL;
  if (!endpoint) return null;
  const cached = await input.database
    .from("coarse_location_labels")
    .select("label")
    .eq("grid_key", input.location.key)
    .maybeSingle();
  if (cached.error === null && typeof cached.data?.label === "string") {
    return cached.data.label;
  }
  const center = coarseLocationCenter(input.location);
  if (center === null) return null;

  try {
    const url = new URL(endpoint);
    url.searchParams.set("lat", center.latitude.toFixed(6));
    url.searchParams.set("lon", center.longitude.toFixed(6));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "10");
    const response = await (input.fetchImplementation ?? fetch)(url, {
      headers: {
        accept: "application/json",
        "accept-language": "ja,en;q=0.7",
        "user-agent":
          process.env.GEOCODER_USER_AGENT ??
          `ReMemory/1.0 (${process.env.APP_ORIGIN ?? "local-development"})`,
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const label = localityLabel(payload);
    if (label === null) return null;
    const stored = await input.database.from("coarse_location_labels").upsert(
      {
        grid_key: input.location.key,
        label,
        provider: new URL(endpoint).hostname.slice(0, 80),
      },
      { onConflict: "grid_key" },
    );
    return stored.error === null ? label : null;
  } catch {
    // Location enrichment is optional; uploads must still succeed with a grid.
    return null;
  }
}

function localityLabel(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const address = (value as Record<string, unknown>).address;
  if (address === null || typeof address !== "object") return null;
  const fields = address as Record<string, unknown>;
  const region = firstText(fields, ["state", "province", "region"]);
  const locality = firstText(fields, [
    "city",
    "town",
    "village",
    "municipality",
    "county",
  ]);
  const label = [region, locality]
    .filter((item, index, items): item is string =>
      item !== null ? items.indexOf(item) === index : false,
    )
    .join("")
    .normalize("NFKC")
    .trim();
  return label.length > 0 && label.length <= 120 ? label : null;
}

function firstText(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim().length > 0) {
      return value[key].trim();
    }
  }
  return null;
}
