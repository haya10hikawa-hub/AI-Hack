import "server-only";

import { NextRequest } from "next/server";

export class RequestSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

export function assertSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestSecurityError("Cross-site state changes are not allowed.");
  }
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidate = origin ?? referer;

  if (candidate === null) {
    if (process.env.NODE_ENV === "test") return;
    throw new RequestSecurityError("A same-origin request is required.");
  }

  let candidateOrigin: string;
  try {
    candidateOrigin = new URL(candidate).origin;
  } catch {
    throw new RequestSecurityError("The request origin is invalid.");
  }

  const configuredOrigin =
    process.env.APP_ORIGIN ??
    (process.env.VERCEL_URL === undefined
      ? undefined
      : `https://${process.env.VERCEL_URL}`);
  let expected: string;
  try {
    expected = configuredOrigin
      ? new URL(configuredOrigin).origin
      : request.nextUrl.origin;
  } catch {
    throw new RequestSecurityError(
      "The configured application origin is invalid.",
    );
  }
  if (candidateOrigin !== expected) {
    throw new RequestSecurityError(
      "Cross-origin state changes are not allowed.",
    );
  }
}

export function requestId(request: NextRequest): string {
  const supplied = request.headers.get("x-request-id");
  return supplied !== null && /^[a-zA-Z0-9._-]{1,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}
