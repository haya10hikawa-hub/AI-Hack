import "server-only";

import { latLngToCell } from "h3-js";
import { z } from "zod";

import {
  PlaceCandidateSchema,
  SelectedPlaceSchema,
  type PlaceCandidate,
  type SelectedPlace,
} from "@/src/domain/place";

const ProviderRowSchema = z
  .object({
    osm_type: z.enum(["node", "way", "relation"]),
    osm_id: z.union([z.string(), z.number()]),
    lat: z.union([z.string(), z.number()]),
    lon: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    display_name: z.string().optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    addresstype: z.string().optional(),
    address: z.record(z.string(), z.unknown()).optional(),
    namedetails: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ProviderRowsSchema = z.array(ProviderRowSchema).max(20);
const candidatePattern = /^nominatim:([NWR])(\d{1,30})$/u;

export class PlaceProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceProviderUnavailableError";
  }
}

export interface PlaceProvider {
  search(query: string): Promise<PlaceCandidate[]>;
  resolve(candidateId: string): Promise<SelectedPlace | null>;
}

export function createPlaceProviderFromEnv(input?: {
  fetchImplementation?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}): PlaceProvider {
  const endpoint = input?.endpoint ?? process.env.PLACE_PROVIDER_API_BASE_URL;
  if (!endpoint) {
    throw new PlaceProviderUnavailableError(
      "Place provider is not configured.",
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(endpoint);
  } catch {
    throw new PlaceProviderUnavailableError("Place provider URL is invalid.");
  }
  if (baseUrl.protocol !== "https:" && process.env.NODE_ENV !== "test") {
    throw new PlaceProviderUnavailableError("Place provider must use HTTPS.");
  }
  return new NominatimPlaceProvider(
    baseUrl,
    input?.fetchImplementation ?? fetch,
    input?.timeoutMs ?? 3500,
  );
}

class NominatimPlaceProvider implements PlaceProvider {
  constructor(
    private readonly baseUrl: URL,
    private readonly fetchImplementation: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  async search(query: string): Promise<PlaceCandidate[]> {
    const url = this.url("search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("limit", "8");
    const rows = await this.request(url);
    const candidates = new Map<string, PlaceCandidate>();
    for (const row of rows) {
      const id = providerId(row);
      if (id === null || candidates.has(id)) continue;
      candidates.set(id, publicCandidate(row, id));
      if (candidates.size === 8) break;
    }
    return [...candidates.values()];
  }

  async resolve(candidateId: string): Promise<SelectedPlace | null> {
    const parsedId = candidatePattern.exec(candidateId);
    if (parsedId === null) return null;
    const url = this.url("lookup");
    url.searchParams.set("osm_ids", `${parsedId[1]}${parsedId[2]}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    const row = (await this.request(url))[0];
    if (row === undefined || providerId(row) !== candidateId) return null;
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    const candidate = publicCandidate(row, candidateId);
    // Exact coordinates exist only in these local variables. They are reduced
    // to an H3 cell before this trusted object can leave the adapter.
    return SelectedPlaceSchema.parse({
      provider: "nominatim",
      providerPlaceId: candidate.id.slice("nominatim:".length),
      displayName: candidate.name,
      coarseArea: candidate.area,
      category: candidate.category,
      mapCellId: latLngToCell(latitude, longitude, 10),
    });
  }

  private url(path: "search" | "lookup"): URL {
    const base = new URL(this.baseUrl);
    const normalized = base.pathname.replace(/\/(?:search|lookup)\/?$/u, "");
    base.pathname = `${normalized.replace(/\/$/u, "")}/${path}`;
    base.search = "";
    return base;
  }

  private async request(url: URL) {
    try {
      const response = await this.fetchImplementation(url, {
        headers: {
          accept: "application/json",
          "accept-language": "ja,en;q=0.7",
          "user-agent":
            process.env.PLACE_PROVIDER_USER_AGENT ??
            `ReMemory/1.0 (${process.env.APP_ORIGIN ?? "local-development"})`,
          ...(process.env.PLACE_PROVIDER_API_KEY
            ? { authorization: `Bearer ${process.env.PLACE_PROVIDER_API_KEY}` }
            : {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new PlaceProviderUnavailableError("Place provider failed.");
      }
      return ProviderRowsSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof PlaceProviderUnavailableError) throw error;
      throw new PlaceProviderUnavailableError("Place provider failed.");
    }
  }
}

function publicCandidate(
  row: z.infer<typeof ProviderRowSchema>,
  id: string,
): PlaceCandidate {
  const displayName = cleanText(
    text(row.namedetails?.name) ?? row.name ?? row.display_name?.split(",")[0],
    160,
  );
  const fallback = cleanText(row.display_name, 160);
  const name = displayName ?? fallback ?? "名称未設定の場所";
  return PlaceCandidateSchema.parse({
    id,
    name,
    area: areaLabel(row.address),
    category: cleanText(row.addresstype ?? row.type ?? row.category, 80),
  });
}

function providerId(row: z.infer<typeof ProviderRowSchema>): string | null {
  const prefix = { node: "N", way: "W", relation: "R" }[row.osm_type];
  const rawId = String(row.osm_id);
  return /^\d{1,30}$/u.test(rawId) ? `nominatim:${prefix}${rawId}` : null;
}

function areaLabel(
  address: Record<string, unknown> | undefined,
): string | null {
  if (address === undefined) return null;
  const values = [
    text(address.state),
    text(address.city) ??
      text(address.town) ??
      text(address.village) ??
      text(address.municipality) ??
      text(address.county),
  ].filter(
    (value, index, all): value is string =>
      value !== null && all.indexOf(value) === index,
  );
  return cleanText(values.join(" "), 160);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function cleanText(value: string | undefined | null, maximum: number) {
  if (!value) return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[<>\u0000-\u001f\u007f]/gu, "");
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}
