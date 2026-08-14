import { NextRequest } from "next/server";
import { z } from "zod";

import { requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import {
  createPlaceProviderFromEnv,
  PlaceProviderUnavailableError,
} from "@/src/server/places/provider";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";

const QuerySchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(2).max(80));

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    await requireAuthenticatedUser();
    const query = QuerySchema.parse(
      request.nextUrl.searchParams.get("q") ?? "",
    );
    const candidates = await createPlaceProviderFromEnv().search(query);
    return dataResponse({ candidates });
  } catch (error) {
    if (error instanceof PlaceProviderUnavailableError) {
      return errorResponse(
        503,
        "PLACE_PROVIDER_UNAVAILABLE",
        "場所候補を取得できませんでした。場所を設定せず写真を追加できます。",
        id,
      );
    }
    return routeError(error, id);
  }
}
