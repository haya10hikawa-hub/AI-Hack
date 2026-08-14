import { NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin, requestId } from "@/src/server/http/security";
import {
  dataResponse,
  errorResponse,
  routeError,
} from "@/src/server/http/responses";
import { RepositoryError } from "@/src/server/services/memories";
import { requireAuthenticatedUser } from "@/src/server/supabase/auth";
import { createSupabaseAdminClient } from "@/src/server/supabase/client";

const PatchSchema = z
  .object({
    usePhotos: z.boolean().optional(),
    useCapturedAt: z.boolean().optional(),
    useLocation: z.boolean().optional(),
    useCalendar: z.boolean().optional(),
    usePersonalContext: z.boolean().optional(),
    searchLearning: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const selectedColumns =
  "use_photos,use_captured_at,use_location,use_calendar,use_personal_context,search_learning_enabled";

function toPayload(row: Record<string, unknown>) {
  return {
    usePhotos: row.use_photos === true,
    useCapturedAt: row.use_captured_at === true,
    useLocation: row.use_location === true,
    useCalendar: row.use_calendar === true,
    usePersonalContext: row.use_personal_context !== false,
    searchLearning: row.search_learning_enabled === true,
    locationPermissionState: "prompt" as const,
    calendarConnectionState: "not_connected" as const,
  };
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const { user, supabase } = await requireAuthenticatedUser();
    const { data, error } = await supabase
      .from("user_preferences")
      .select(selectedColumns)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error !== null) throw new RepositoryError("get_preferences");
    if (data !== null) return dataResponse(toPayload(data));

    const inserted = await createSupabaseAdminClient()
      .from("user_preferences")
      .insert({ user_id: user.id })
      .select(selectedColumns)
      .single();
    if (inserted.error !== null)
      throw new RepositoryError("create_preferences");
    return dataResponse(toPayload(inserted.data));
  } catch (error) {
    return routeError(error, id);
  }
}

export async function PATCH(request: NextRequest) {
  const id = requestId(request);
  try {
    assertSameOrigin(request);
    const input = PatchSchema.parse(await request.json());
    if (input.useCalendar === true) {
      return errorResponse(
        409,
        "CALENDAR_NOT_CONNECTED",
        "カレンダーはまだ接続されていません。",
        id,
      );
    }
    const { user, supabase } = await requireAuthenticatedUser();
    const patch = {
      ...(input.usePhotos === undefined ? {} : { use_photos: input.usePhotos }),
      ...(input.useCapturedAt === undefined
        ? {}
        : { use_captured_at: input.useCapturedAt }),
      ...(input.useLocation === undefined
        ? {}
        : { use_location: input.useLocation }),
      ...(input.useCalendar === undefined
        ? {}
        : { use_calendar: input.useCalendar }),
      ...(input.usePersonalContext === undefined
        ? {}
        : { use_personal_context: input.usePersonalContext }),
      ...(input.searchLearning === undefined
        ? {}
        : { search_learning_enabled: input.searchLearning }),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("user_preferences")
      .update(patch)
      .eq("user_id", user.id)
      .select(selectedColumns)
      .single();
    if (error !== null) throw new RepositoryError("update_preferences");
    if (input.searchLearning === false) {
      const removed = await createSupabaseAdminClient()
        .from("search_feedback")
        .delete()
        .eq("user_id", user.id);
      if (removed.error !== null)
        throw new RepositoryError("clear_search_feedback");
    }
    return dataResponse(toPayload(data));
  } catch (error) {
    return routeError(error, id);
  }
}
