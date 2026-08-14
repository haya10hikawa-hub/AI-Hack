import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";
import { gridDisk } from "h3-js";

const DEMO_EMAIL = "memory-map-demo@local.rememory.test";
const DEMO_PASSWORD = "MemoryMapDemo-2026!";
const LOCAL_API_URLS = new Set([
  "http://127.0.0.1:54321",
  "http://localhost:54321",
]);

function localCredentials() {
  let output;
  try {
    output = execFileSync(
      "pnpm",
      ["dlx", "supabase@latest", "status", "-o", "env"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new Error(
      "Local Supabase is not running. Run `pnpm dlx supabase@latest start` first.",
    );
  }
  const values = new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/u);
    if (match) values.set(match[1], match[2]);
  }
  const url = values.get("API_URL");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey || !LOCAL_API_URLS.has(url)) {
    throw new Error(
      "Refusing to seed: this command only accepts the local Supabase API on port 54321.",
    );
  }
  return { url, serviceRoleKey };
}

function assertOk(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

const { url, serviceRoleKey } = localCredentials();
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const existingUsers = assertOk(
  await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  "list demo users",
).users;
const existing = existingUsers.find((user) => user.email === DEMO_EMAIL);
if (existing) {
  assertOk(
    await supabase.auth.admin.deleteUser(existing.id),
    "reset demo user",
  );
}

const created = assertOk(
  await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Memory Map Demo" },
  }),
  "create demo user",
);
const userId = created.user.id;
assertOk(
  await supabase
    .from("user_preferences")
    .update({ memory_map_enabled: true })
    .eq("user_id", userId),
  "enable Memory Map",
);

const baseCell = "8a2e6e82175ffff";
const [passedCell, experiencedCell, firstMemoryCell, secondMemoryCell] =
  gridDisk(baseCell, 1).slice(0, 4);

const events = [
  {
    id: "de000000-0000-4000-8000-000000000001",
    user_id: userId,
    started_at: "2026-04-12T09:00:00+09:00",
    ended_at: "2026-04-12T12:00:00+09:00",
    coarse_place: "神山周辺",
    title_candidate: "FTC練習",
    status: "active",
  },
  {
    id: "de000000-0000-4000-8000-000000000002",
    user_id: userId,
    started_at: "2026-05-18T10:00:00+09:00",
    ended_at: "2026-05-18T15:00:00+09:00",
    coarse_place: "神山周辺",
    title_candidate: "学校イベント",
    status: "active",
  },
];
const memories = [
  {
    id: "db000000-0000-4000-8000-000000000001",
    user_id: userId,
    event_id: events[0].id,
    title: "FTC練習",
    summary: "ロボットを調整し、チームで動作を確認した日のMemory。",
    status: "active",
    importance_band: "high",
    importance_reasons: ["チーム活動", "継続的な制作"],
  },
  {
    id: "db000000-0000-4000-8000-000000000002",
    user_id: userId,
    event_id: events[1].id,
    title: "学校イベント",
    summary: "学校で仲間とイベントを準備し、当日を迎えたMemory。",
    status: "active",
    importance_band: "medium",
    importance_reasons: ["学校生活", "共同体験"],
  },
];
const evidence = memories.map((memory, index) => ({
  id: `da000000-0000-4000-8000-00000000000${index + 1}`,
  user_id: userId,
  event_id: memory.event_id,
  kind: "demo_user_statement",
  field: "activity",
  value_json: { value: memory.title },
  source_type: "user_statement",
  source_version: "local-demo-v1",
  dedupe_key: `memory-map-demo-evidence-${index + 1}`,
  observed_at: events[index].started_at,
  validity: "valid",
}));
const claims = memories.map((memory, index) => ({
  id: `dc000000-0000-4000-8000-00000000000${index + 1}`,
  user_id: userId,
  memory_id: memory.id,
  field: "activity",
  value_json: { value: memory.title },
  origin: "deterministic",
  confidence_band: "high",
  confirmation_status: "unconfirmed",
  status: "active",
  dedupe_key: `memory-map-demo-claim-${index + 1}`,
}));

assertOk(await supabase.from("events").insert(events), "insert demo events");
assertOk(
  await supabase.from("memories").insert(memories),
  "insert demo memories",
);
assertOk(
  await supabase.from("evidence").insert(evidence),
  "insert demo evidence",
);
assertOk(await supabase.from("claims").insert(claims), "insert demo claims");
assertOk(
  await supabase.from("claim_evidence").insert(
    claims.map((claim, index) => ({
      user_id: userId,
      claim_id: claim.id,
      evidence_id: evidence[index].id,
    })),
  ),
  "link demo provenance",
);
assertOk(
  await supabase.from("memory_map_cells").insert([
    {
      user_id: userId,
      cell_id: passedCell,
      state: "passed",
      visit_count: 1,
      coarse_place: "神山周辺",
      first_seen_at: "2026-03-01T09:00:00+09:00",
      last_seen_at: "2026-03-01T09:00:00+09:00",
    },
    {
      user_id: userId,
      cell_id: experiencedCell,
      state: "experienced",
      visit_count: 2,
      dwell_bucket: "medium",
      evidence_count: 1,
      coarse_place: "神山周辺",
      first_seen_at: "2026-03-20T09:00:00+09:00",
      last_seen_at: "2026-03-20T10:00:00+09:00",
    },
    {
      user_id: userId,
      cell_id: firstMemoryCell,
      state: "experienced",
      visit_count: 3,
      dwell_bucket: "long",
      evidence_count: 1,
      coarse_place: "神山周辺",
      first_seen_at: "2026-04-12T09:00:00+09:00",
      last_seen_at: "2026-08-14T09:00:00+09:00",
    },
    {
      user_id: userId,
      cell_id: secondMemoryCell,
      state: "experienced",
      visit_count: 2,
      dwell_bucket: "long",
      evidence_count: 1,
      coarse_place: "神山周辺",
      first_seen_at: "2026-05-18T10:00:00+09:00",
      last_seen_at: "2026-07-20T10:00:00+09:00",
    },
  ]),
  "insert demo Map cells",
);
assertOk(
  await supabase.from("memory_map_cell_memories").insert([
    {
      user_id: userId,
      cell_id: firstMemoryCell,
      memory_id: memories[0].id,
    },
    {
      user_id: userId,
      cell_id: secondMemoryCell,
      memory_id: memories[1].id,
    },
  ]),
  "link demo Map Memories",
);

process.stdout.write(
  [
    "Memory Map local demo is ready.",
    `URL: http://127.0.0.1:3000/auth/login`,
    `Email: ${DEMO_EMAIL}`,
    `Password: ${DEMO_PASSWORD}`,
    "Re-running this command deletes and recreates only this fixed local demo account.",
  ].join("\n") + "\n",
);
