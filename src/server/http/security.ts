import "server-only";

import { NextRequest } from "next/server";

export class RequestSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

/**
 * How the caller proved who they are. `cookie` and `preview` are the existing
 * browser paths. `bearer` is the native client path and carries no ambient
 * browser credential.
 */
export type RequestAuthMode = "cookie" | "bearer" | "preview";

export class BearerTokenError extends Error {
  constructor() {
    // The rejected token must never reach a message, a log line, or a response.
    super("The bearer token was rejected.");
    this.name = "BearerTokenError";
  }
}

// Supabase access tokens are JWTs. Only that shape is forwarded, so a malformed
// header is refused here instead of travelling further into the request.
const bearerPattern = /^Bearer[ \t]+([A-Za-z0-9._~+/-]+=*)$/u;

export function hasAuthorizationHeader(request: NextRequest): boolean {
  return request.headers.get("authorization") !== null;
}

/**
 * Returns the caller's access token, or `null` when no Authorization header was
 * sent at all. A header that is present but unusable throws, so a native client
 * can never silently fall back to the cookie session or to Public Preview.
 */
export function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const token = bearerPattern.exec(header.trim())?.[1] ?? null;
  if (token === null || token.length < 20 || token.length > 8_192) {
    throw new BearerTokenError();
  }
  return token;
}

/**
 * State-changing requests keep the browser boundary they already had. A bearer
 * caller is exempt from the origin check because the check exists to stop a
 * cross-site page from spending an ambient cookie: a bearer request carries no
 * such credential, and cross-origin browser code cannot attach an Authorization
 * header without a CORS preflight this app never answers.
 *
 * Every caller of this function must also resolve the request auth context,
 * which rejects an unverifiable token with 401 before any state changes.
 */
export function assertMutationAllowed(request: NextRequest): void {
  if (hasAuthorizationHeader(request)) return;
  assertSameOrigin(request);
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
