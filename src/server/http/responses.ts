import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ConfigurationError } from "@/src/server/config";
import { RequestSecurityError } from "@/src/server/http/security";
import { AuthenticationError } from "@/src/server/supabase/auth";
import { AIProviderError } from "@/src/server/ai/provider";

export function dataResponse<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { data },
    {
      ...init,
      headers: {
        "cache-control": "private, no-store",
        ...init?.headers,
      },
    },
  );
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId?: string,
) {
  return NextResponse.json(
    { error: { code, message, requestId } },
    {
      status,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

export function routeError(error: unknown, id?: string) {
  if (error instanceof AuthenticationError) {
    return errorResponse(401, "AUTH_REQUIRED", "ログインが必要です。", id);
  }
  if (error instanceof RequestSecurityError) {
    return errorResponse(
      403,
      "ORIGIN_REJECTED",
      "安全でないリクエストを拒否しました。",
      id,
    );
  }
  if (error instanceof ConfigurationError) {
    return errorResponse(
      503,
      "SERVICE_NOT_CONFIGURED",
      "この環境では保存サービスがまだ設定されていません。",
      id,
    );
  }
  if (error instanceof ZodError) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "入力内容を確認してください。",
      id,
    );
  }
  if (error instanceof AIProviderError) {
    if (error.code === "rate_limited") {
      return errorResponse(
        429,
        "AI_RATE_LIMITED",
        "AI処理が混み合っています。少し待って再度お試しください。",
        id,
      );
    }
    if (error.code === "cost_limit") {
      return errorResponse(
        429,
        "AI_COST_LIMIT",
        "本日のAI処理上限に達しました。保存済みのMemoryは引き続き利用できます。",
        id,
      );
    }
    return errorResponse(
      503,
      "AI_UNAVAILABLE",
      "AI処理を安全に完了できませんでした。時間をおいて再度お試しください。",
      id,
    );
  }

  // Do not send database/provider details or private content to the browser.
  console.error("route_failure", {
    requestId: id,
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return errorResponse(
    500,
    "INTERNAL_ERROR",
    "処理を完了できませんでした。",
    id,
  );
}
