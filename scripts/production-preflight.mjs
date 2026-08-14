import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const envFileArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--env-file="));
const env = {
  ...process.env,
  ...(envFileArg
    ? await readEnvFile(envFileArg.slice("--env-file=".length))
    : {}),
};
const checkHealth = args.has("--check-health");
const checkModels = args.has("--check-models");
const errors = [];
const warnings = [];

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "CRON_SECRET",
  "APP_ORIGIN",
  "AI_API_BASE_URL",
  "AI_API_KEY",
  "AI_PROVIDER_NAME",
  "AI_MODEL_VISION_CHEAP",
  "AI_MODEL_EVENT_CHEAP",
  "AI_MODEL_CHAT_CHEAP",
  "AI_MODEL_EVENT_STRONG",
];

for (const name of required) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is missing.`);
  } else if (isPlaceholder(value)) {
    errors.push(`${name} still uses a placeholder value.`);
  }
}

expectHttpsUrl("NEXT_PUBLIC_SUPABASE_URL");
expectHttpsUrl("APP_ORIGIN");
expectOpenAiBaseUrl("AI_API_BASE_URL");
expectSecret("SUPABASE_SECRET_KEY", 32);
expectSecret("CRON_SECRET", 32);
expectSecret("AI_API_KEY", 16);

if (env.AI_PROVIDER_NAME?.trim() !== "orcarouter") {
  warnings.push(
    `AI_PROVIDER_NAME is ${env.AI_PROVIDER_NAME}; verify the provider adapter supports it.`,
  );
}

for (const name of [
  "AI_MAX_COST_USD_PER_USER_DAY",
  "AI_MAX_COST_USD_PER_REQUEST",
  "AI_MAX_REQUESTS_PER_USER_MINUTE",
  "AI_REQUEST_TIMEOUT_MS",
  "AI_UPLOAD_TIMEOUT_MS",
  "AI_MAX_RETRIES",
  "AI_MAX_RESPONSE_BYTES",
  "UPLOAD_MAX_FILES",
  "UPLOAD_MAX_BYTES_PER_FILE",
  "UPLOAD_MAX_PIXELS",
  "VISION_MAX_EDGE",
]) {
  if (env[name] !== undefined && !Number.isFinite(Number(env[name]))) {
    errors.push(`${name} must be numeric when set.`);
  }
}

if (Number(env.AI_UPLOAD_TIMEOUT_MS ?? 8000) > 15000) {
  warnings.push(
    "AI_UPLOAD_TIMEOUT_MS is high for the 60-second background route budget.",
  );
}

if (env.GEOCODER_API_BASE_URL) {
  expectHttpsUrl("GEOCODER_API_BASE_URL");
  if (!env.GEOCODER_USER_AGENT?.trim()) {
    warnings.push(
      "GEOCODER_USER_AGENT is recommended when GEOCODER_API_BASE_URL is set.",
    );
  }
}

if (checkHealth && errors.length === 0) {
  await checkProductionHealth();
}

if (checkModels && errors.length === 0) {
  await checkProviderModels();
}

if (warnings.length > 0) {
  process.stdout.write(
    `Warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}\n`,
  );
}

if (errors.length > 0) {
  process.stderr.write(
    `Production preflight failed:\n${errors.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write("Production preflight passed.\n");

function expectHttpsUrl(name) {
  const value = env[name]?.trim();
  if (!value || isPlaceholder(value)) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`${name} must use https in production.`);
    }
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

function expectOpenAiBaseUrl(name) {
  const value = env[name]?.trim();
  if (!value || isPlaceholder(value)) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`${name} must use https in production.`);
    }
    if (!parsed.pathname.replace(/\/$/u, "").endsWith("/v1")) {
      warnings.push(
        `${name} should point at an OpenAI-compatible /v1 endpoint.`,
      );
    }
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

function expectSecret(name, minimumLength) {
  const value = env[name]?.trim();
  if (!value || isPlaceholder(value)) return;
  if (value.length < minimumLength) {
    errors.push(`${name} should be at least ${minimumLength} characters.`);
  }
}

function isPlaceholder(value) {
  return /^(replace-me|your-|https:\/\/your-|test-password|example)/iu.test(
    value,
  );
}

async function checkProductionHealth() {
  const origin = env.APP_ORIGIN?.trim();
  if (!origin) return;
  const response = await fetch(new URL("/api/health", origin), {
    headers: { accept: "application/json" },
  }).catch((error) => {
    errors.push(`/api/health request failed: ${error.message}`);
    return null;
  });
  if (!response) return;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    errors.push(`/api/health returned HTTP ${response.status}.`);
    return;
  }
  const data = payload?.data ?? payload;
  for (const key of ["database", "storage", "aiConfiguration"]) {
    if (data?.checks?.[key] !== true) {
      errors.push(`/api/health check ${key} is not true.`);
    }
  }
}

async function checkProviderModels() {
  const baseUrl = env.AI_API_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  if (!baseUrl || !apiKey) return;
  const response = await fetch(
    new URL("models", ensureTrailingSlash(baseUrl)),
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    },
  ).catch((error) => {
    errors.push(`/v1/models request failed: ${error.message}`);
    return null;
  });
  if (!response) return;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    errors.push(`/v1/models returned HTTP ${response.status}.`);
    return;
  }
  const modelIds = new Set(
    Array.isArray(payload?.data)
      ? payload.data
          .map((model) => model?.id)
          .filter((id) => typeof id === "string")
      : [],
  );
  if (modelIds.size === 0) {
    warnings.push(
      "/v1/models returned no model ids; verify the provider manually.",
    );
    return;
  }
  for (const name of [
    "AI_MODEL_VISION_CHEAP",
    "AI_MODEL_EVENT_CHEAP",
    "AI_MODEL_CHAT_CHEAP",
    "AI_MODEL_EVENT_STRONG",
  ]) {
    const modelId = env[name]?.trim();
    if (modelId && !modelIds.has(modelId)) {
      errors.push(`${name}=${modelId} was not found in /v1/models.`);
    }
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readEnvFile(path) {
  const text = await readFile(resolve(path), "utf8");
  const parsed = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    parsed[match[1]] = unquote(match[2].trim());
  }
  return parsed;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
