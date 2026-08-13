"use client";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.message === "string") return value.message;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }
  return null;
}

function responseCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.code === "string") return value.code;
  if (isRecord(value.error) && typeof value.error.code === "string") {
    return value.error.code;
  }
  return null;
}

function unwrapPayload<T>(value: unknown): T {
  if (isRecord(value) && "data" in value) return value.data as T;
  return value as T;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;
  if (
    hasBody &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "サーバーに接続できません。通信状態を確認して、もう一度お試しください。",
      0,
      "NETWORK_ERROR",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const fallback =
      response.status === 401
        ? "ログインの有効期限が切れました。もう一度ログインしてください。"
        : response.status === 429
          ? "処理が混み合っています。少し待ってから、もう一度お試しください。"
          : "処理を完了できませんでした。時間をおいて再度お試しください。";
    throw new ApiError(
      responseMessage(payload) ?? fallback,
      response.status,
      responseCode(payload),
    );
  }

  return unwrapPayload<T>(payload);
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
