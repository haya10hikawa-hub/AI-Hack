# Re:Memory — Implementation Handoff / AI Development Prompt

> AI HACK 2026 MVP
>
> この文書は、人間の開発者・AIコーディングエージェントのどちらにも渡せる実装指示書です。
> 単なる画面デモではなく、主要フローが実データで動作するWebアプリを作ってください。

---

## 0. 最重要方針

Re:Memoryは写真検索アプリではない。

**写真・動画・日時・場所などのEvidenceから出来事を理解し、AIが不足Contextを検出し、ユーザーの軽い確認によってMemoryを形成し、後から曖昧な言葉で思い出せるPersonal Memory AI**である。

Core Loop:

```text
Media
→ Metadata
→ Temporal Sequence
→ Event
→ Evidence
→ AI Inference
→ Memory Gap Detection
→ User Confirmation
→ Memory
→ Hybrid Retrieval / Recall
```

AIはユーザーの記憶を勝手に確定しない。

```text
Evidence
→ AI Inference
→ User Confirmation
→ Confirmed Memory
```

---

# 1. 開発開始前に必ず行うこと

既存コードがある場合、いきなり書き換えない。

以下を確認する。

- package.json / lock file
- Framework / Language
- routing
- src / app / components
- Design Token / CSS
- state management
- Auth
- Database / migrations
- Storage
- API
- AI integration
- environment variables
- tests
- deploy設定
- README / AGENTS.md等

その後、`IMPLEMENTATION_PLAN.md` を作る。

最低限記載すること:

1. 現在実装済み
2. 未実装
3. 再利用可能なもの
4. 修正が必要なもの
5. DB migration方針
6. API方針
7. UI方針
8. Security上の注意
9. テスト方針
10. 実装順序
11. 合理的に置いた仮定

正常な既存機能を不用意に壊さない。

---

# 2. Product Principles

## Evidence First

AIが出す事実的ClaimにはEvidence参照を持たせる。

## No Fabricated Memory

写真・Metadata・User Statement等に根拠がない記憶を作らない。

## Truth Layerを分離

以下を混ぜない。

1. Deterministic Observation
2. AI Inference
3. User Confirmed
4. Conflict / Unknown

## Uncertainty is a Feature

分からない場合は分からないと扱う。

## Ask the Human

不足Contextがある場合は人間へ確認できる。ただし質問しすぎない。

## Human Correction

ユーザー確認・訂正はAI推論より優先する。

## Provenance

ClaimがどのEvidence / UserCorrection / AI Runから来たか追跡できる。

## Privacy First

個人写真・位置情報・ユーザー情報を必要以上に外部AIへ送らない。

---

# 3. Hero Flow — 最優先で完成させる

この一本が実データで最後まで動くことを最優先する。

1. ユーザーが約10枚の写真をUpload
2. validation
3. EXIF / metadata抽出
4. 時間・場所からTemporal Sequence候補を生成
5. Sequenceから代表画像を選ぶ
6. metadataを除去した縮小画像をVision AIへ送る
7. structured Observation生成
8. Event生成
9. Evidence-backed Memory draft生成
10. Memory Importance評価
11. Context Completeness評価
12. Memory Gap Detection
13. 質問価値と候補精度が十分な場合だけ確認候補を作る
14. Homeに非同期で「確認したいMemory」として表示
15. ユーザーが確認Flowを開始
16. `そう / 違う / あとで` で回答
17. UserCorrection + user-origin Claimとして保存
18. UI上でAI推定Relationがconfirmed relationへ変化
19. 後から曖昧な自然言語で検索
20. Hybrid Retrieval
21. 候補が曖昧なら2〜3件提示
22. 選択したMemoryからEvidence付きGrounded Answer

**hard-codedされたAI回答でHero Flowを成立させないこと。**

---

# 4. Media Ingestion

共通抽象を用意する。

```text
MediaSource
├─ UploadSource
├─ CameraSource
└─ PhotoLibrarySource   // 将来
```

`MediaAsset` は写真/動画共通モデルにする。

```text
MediaAsset
├─ image
└─ video
```

### MVP

- image: 実処理する
- video: データモデルは対応可能にする
- video AI解析: MVPでは不要
- full camera roll自動同期: MVPでは不要
- background photo sync: MVPでは不要

PhotoLibrarySource / Location permissionは将来の実装を差し込める構造に留めてよい。

---

# 5. Metadata Layer

AIより先に処理する。

取得可能な情報:

- capturedAt
- timezone情報
- dimensions
- mimeType
- bytes
- sha256
- EXIF GPS

位置情報は最小化する。

```text
exact GPS
→ server-side extraction
→ coarse locationへ変換
→ exact座標は通常DB / Analytics / AI inputへ保存しない
```

AIへ送らない:

- exact GPS
- full EXIF
- original filename
- user identity

Visionへは縮小・metadata-stripped derivativeを送る。

---

# 6. Temporal Sequence

写真を完全に1枚ずつ独立解析しない。

まずMetadataからSequence候補を作る。

```text
MediaAsset[]
→ capturedAt sort
→ time gap
→ coarse location
→ Sequence
```

その後:

- representative framesを選択
- near-duplicate / burstを減らす
- 必要な画像だけVisionへ送る
- 単発写真もSequenceとして扱う

目的は「何が写っているか」だけでなく、**その時間に何が起きていたか**を理解すること。

---

# 7. AI Adapter / Routing

AI providerアクセスはserver-side限定。

OrcaRouter compatible APIをadapter経由で利用する。

UI componentから直接AI APIを呼ばない。

推奨interface:

```ts
interface AIProvider {
  analyzeSequence(...): Promise<...>
  generateEventClaims(...): Promise<...>
  detectMemoryGap(...): Promise<...>
  parseSearchQuery(...): Promise<...>
  rerankSearchCandidates(...): Promise<...>
  generateGroundedAnswer(...): Promise<...>
}
```

Routing class:

- VISION_CHEAP
- EVENT_CHEAP
- CHAT_CHEAP
- EVENT_STRONG

Strong modelは例外的に利用する。

すべてのAI outputをZod/JSON Schema等で検証する。

AI outputに以下をさせない。

- authorization判定
- delete実行
- state transition直接実行
- arbitrary DB write
- external tool execution

---

# 8. Memory Importance

正式採用。

AIだけで「大切な思い出」と決めない。

```text
Deterministic Signals
+
AI Context Signal
→ Processing Priority
```

Band:

- low
- medium
- high

意味は「人生にとって重要」ではなく、**Memory Gap確認を優先するべきか**。

Deterministic Signal候補:

- photo count
- sequence duration
- unusual location
- temporal density
- visual change
- related confirmed memories
- repeated user interaction

判定理由を保存する。

---

# 9. Context Completeness

Confidenceとは別概念。

Memoryごとに以下を管理する。

- time
- location
- activity
- purpose
- people
- result
- meaning

Status:

- known
- missing
- unknown
- not_applicable

100%埋めることを目標にしない。

---

# 10. Memory Gap Detection

Re:Memoryの独自性の中核。

定義:

> 未来にMemoryを理解するために価値があるが、現在のEvidenceでは不足しているContext

質問を出すにはGateを通す。

```text
Memory Importanceが十分
AND
Memory Gapが存在
AND
候補を十分絞れている
→ 確認候補を出す
```

低品質な質問を大量に出さない。

Adaptive Clarification:

- 原則1問
- 必要時のみ最大3問
- 十分なContextが取れたら終了
- 同じ質問を繰り返さない

質問は自由記述を基本にしない。

Tap-first:

- Yes / No
- Candidate selection
- option / tags
- Other
- Later
- Skip

`あとで` や無視に対して追撃しない。

---

# 11. Confirmation UX

通常操作中に突然Blocking Modalを出さない。

HomeにEntry Point:

```text
AIが確認したいMemoryが3件あります
[確認する]
```

Flow:

```text
Home
→ Confirmation Queue
→ Question
→ そう / 違う / あとで
→ Next
→ Complete
```

MVP:

```text
Banner / Entry Point
→ Confirmation Screen or Bottom Sheet
→ Toast
```

Modal/Dialogは本当にブロックが必要な操作だけ。

通知タイミングは将来ユーザーごとに設定可能にする。

候補:

- after_event
- evening
- next_day
- on_app_open
- off

MVPではPush Notification infrastructureを必須にしない。

---

# 12. Hybrid Retrieval

正式採用。

```text
Structured Search
+
Semantic Interpretation
+
Personal Context
+
AI Reranking
```

MVPでVector DBは必須にしない。

Flow:

```text
User Query
→ Query Parsing
→ Structured Filter
→ PostgreSQL candidate retrieval
→ AI reranking
→ Confidence Gate
→ Candidate Selection / Answer
```

例:

```text
「去年の春にみんなでロボット作ってた時」

時期: 2025年3月〜5月
人物: team members
内容: robot
活動: build / practice
```

**AIが検索文をどう解釈したかUIに表示する。**

---

# 13. Search Candidate Selection

AIが無理に1件へ決め打ちしない。

- 1位が明確 → 1件を回答
- 候補が拮抗 → 上位2〜3件表示
- 候補が多すぎる → 追加条件 / clarification

主要UIで意味不明な `関連度 92%` のような数値を使わない。

代わりにMatch Reasonを表示する。

例:

- 時期が一致
- 写真内容にロボット
- 場所が一致
- User confirmed contextが一致

候補選択はRetrieval Feedbackとして扱う。

---

# 14. Personal Context

長期Contextとして強く使ってよいもの:

- User confirmed Claim
- User Correction
- 明示的に確認されたAlias
- repeated confirmed vocabulary

AIが1回推測しただけの内容を長期Contextへ固定しない。

1回の検索選択だけで長期学習しない。

```text
Search Feedback
→ short-term context
→ repeated pattern
→ Personal Context candidate
→ 必要ならUser Confirm
→ long-term context
```

ユーザー制御:

- Search learning ON/OFF
- Personal Context reset
- Alias削除

---

# 15. Memory State

MemoryはAI生成直後から「確定記憶」にしない。

```text
Event
→ draft Memory
→ Evidence / Context / User confirmation
→ active Memory
```

主なstate:

- draft
- active
- disputed
- deleting
- deleted

検索ではactiveを優先する。

---

# 16. UI / Brand Direction

一般的なPhoto App / SaaS Dashboardへ寄せない。

維持する世界観:

- Warm White / Ivory
- Indigo
- Coral
- Sage
- Ink
- Serif Display / Heading
- Sans-serif Body
- Photography
- thin border
- minimal shadow
- editorial / album感

避ける:

- gradient乱用
- glassmorphism乱用
- glow乱用
- 全部Card
- 全面Polaroid
- 過剰な角丸
- Sparkle = AIへの依存
- 複雑Network Graph常時表示

---

# 17. Re:Memory Visual Grammar

必ず共通Component / Tokenとして実装する。

```text
Memory      = 面 / Surface / Card
Evidence    = 点 / Node
Relation    = 線
AI推定      = ○ Open Node + Dotted Line
確認済み    = ● Filled Node + Solid Line
Status      = Label / Badge
Time        = Vertical Axis
```

```text
●  = confirmed / Evidence
○  = AI inference
━━ = confirmed relation
┈┈ = inferred relation
```

色だけに依存しない。

- icon
- label
- line style
- state text

も併用する。

---

# 18. Signature UI — Memory Thread

Homeの主役。

普通のカード縦並びTimelineにしない。

Memory Threadとして、時間軸上のMemoryとRelationを見せる。

Home情報優先順位:

1. Memory
2. Memory Relation
3. Evidence

Compact / Expandedを実装する。

### Default / Compact

```text
● FTC Practice
│
├ 5人
├ 神山
└ FTC Practice
```

### Selected / Expanded

```text
      Person
        │
Place ─ Memory ─ Calendar
        │
   Related Memory
```

スマートフォンではGraphを複雑化しない。

一度に全Memoryをexpandしない。

---

# 19. Memory Detail

3階層に分ける。

## Layer 1 — Memory本体

- Hero Photo
- Title
- Date
- Place
- Status

3秒以内に何のMemoryか分かること。

## Layer 2 — AI Memory Summary

AI推定であることを明示する。

## Layer 3 — Evidence

default collapsed。

`この記憶の根拠を見る` から展開。

利用可能なEvidenceだけ表示する。

- photos
- metadata
- calendar（実際に接続されている場合）
- people（確認済みの場合）
- related memory

fake Evidenceを表示しない。

---

# 20. Confidence UI

意味の不明な数値Confidenceを主要表示しない。

```text
推定の確からしさ: 高

根拠
✓ 写真
✓ 撮影日時
✓ カレンダー
? 人物
```

Band:

- high
- medium
- low

Confidenceは真実の確率ではなく**Evidence strength**。

AIに自由生成させず、deterministic downgrade ruleを持つ。

---

# 21. Signature Motion

Motionは装飾ではなく状態変化を説明する。

## Confirm

```text
○ ┈┈┈ ○
↓ user confirm
● ━━━━━ ●
```

## Clarify

少し曖昧 / muted
→ normal clarity

## Recall

Search Result選択時、matched Evidenceを短くHighlight。

Rule:

- 150〜300ms基本
- spring乱用しない
- Reduce Motion対応
- Motionなしでも意味が分かる

---

# 22. Brand Symbol

`Re:Memory` の `:` を2つのMemory Nodeとして扱う方向を第一候補とする。

UIのNode/ThreadとLogo/App IconのVisual Languageを統一できる設計にする。

ただしブランドアセット完成前は、実装をブロックしない。

---

# 23. Navigation

スマートフォン最優先。

最大5個。

候補:

```text
Home
Search
Add
Memories / Confirm
Profile
```

Confirm頻度が低ければHomeのEntry Pointへ統合可能。

SettingsはProfile配下。

---

# 24. Privacy & AI

`Settings > Privacy & AI`

ユーザー設定として少なくとも以下を扱える構造にする。

- usePhotos
- useCapturedAt
- useLocation
- useCalendar
- usePeople
- searchLearning

未接続機能を接続済みのように見せない。

Location permission stateを扱える構造にする。

Privacyは付属機能ではなくTrustの中核。

---

# 25. Shared Memory — Phase 2

Phase 1は個人完結。

MVPで以下は作らない。

- sharing UI
- friends
- follow
-共同編集

ただし将来の共有に拡張しやすいよう、Memoryのowner / visibility等を過度に固定しない。

将来想定:

- participant
- visibility
- share status

人物・関係性をMemory Gapの何番目に優先するかは**保留中**。勝手に固定しない。

---

# 26. 保留中のProduct Decision

以下はまだ最終決定していない。

## A. Delete / Forget UX

ユーザーのデータ削除権・内部cascadeは必要。

ただし「忘れないためのサービス」で削除機能をどの程度前面に出すかは保留。

MVP UIで過度に削除管理を主役にしない。

## B. People / Relationship Gap Priority

Phase 2 Shared Memoryでは重要になる可能性が高いが、Phase 1で質問優先度をどこまで上げるか保留。

**これらを独断でProductの中心仕様に変更しない。**

---

# 27. MVPで作らないもの

- full camera roll automatic sync
- background sync
- video AI analysis
- Push Notification infrastructure
- Shared Memory UI / SNS
- friends / follow
- face recognition
- complex Memory Graph
- Graph DB
- mandatory Vector DB
- payment
- native iOS / Android
- advanced cross-event reasoning

将来拡張可能なinterface / schema設計は可。

---

# 28. 推奨Technology

既存Stackがある場合は正常部分を優先する。

新規なら:

- Frontend: Next.js App Router
- Language: TypeScript
- Styling: Tailwind CSS + CSS Variables / Semantic Tokens
- UI primitives: Radix等を必要最低限
- Icons: Lucide + Re固有Custom SVG
- Backend: Next.js server-side Route Handlers / Server Actions where appropriate
- Database: Supabase PostgreSQL
- Auth: Supabase Auth
- Storage: Supabase Private Storage
- AI: OrcaRouter adapter, server-only
- Validation: Zod
- Unit: Vitest
- E2E: Playwright
- Hosting: Vercel
- Vector DB: MVPでは不要

---

# 29. Database

詳細は `DATABASE_DESIGN.md` をSource of Truthとする。

主要Entity:

- profiles
- user_preferences
- media_assets
- media_sequences
- sequence_assets
- events
- evidence
- memories
- memory_context_dimensions
- claims
- claim_evidence
- user_corrections
- memory_gaps
- memory_relations
- personal_context
- ai_runs

将来:

- memory_participants

---

# 30. Required Data Invariants

絶対に守る。

1. AI ClaimはEvidence参照なしでactiveにしない
2. AI Claimを直接user_confirmedへ書き換えない
3. User ConfirmationはUserCorrection recordとして追加
4. Correctionは元Claimをoverwriteしない
5. Correctionからuser-origin Claimを新規作成
6. User confirmedはAI inferenceより優先
7. user-confirmed同士の矛盾はdisputed
8. unsupported Claimを通常回答に使わない
9. deleted MemoryをRetrievalに使わない
10. exact GPSを通常AI input / Analytics /通常DB columnへ保存しない
11. AI outputからauthorization/delete/state transitionを直接実行しない
12. factual answerはClaim → Evidence/UserCorrectionへ辿れる
13. 1 Assetを同時に複数active Sequence/Eventへ無制限所属させない
14. deleted / rejected / disputed / unsupported Claimを通常回答に混ぜない

---

# 31. Security

最低限:

- Authentication
- Authorization
- Supabase RLS
- Private Storage
- server-only secrets
- service-role keyをbrowserへ出さない
- CSRF consideration
- XSS prevention
- upload validation
- MIME + magic bytes
- size limit
- decoded dimensions limit
- duplicate detection
- rate limiting
- AI cost limit
- AI output schema validation
- signed URL短命化
- exact GPS minimization
- prompt injection mitigation
- user data isolation
- delete capability

写真内文字、filename、user textをAIへのinstructionとして扱わない。

---

# 32. Error / State

主要画面で実装する。

- Loading
- Empty
- Error
- Success
- Offline
- Permission Denied
- AI Processing
- Partial Success
- AI Failed
- Saving
- Saved

理想状態だけ作らない。

---

# 33. Accessibility

- Body 16px前後
- Caption 12〜13px未満を多用しない
- Tap Target 44px以上目安
- keyboard navigation
- visible focus
- semantic HTML
- aria-label
- sufficient contrast
- text scaling
- reduced motion
- stateを色だけに依存させない

---

# 34. Tests

## Unit

- EXIF parser
- media validation
- hash / duplicate
- sequence clustering
- representative selection
- Memory Importance
- Context Completeness
- Claim state transition
- Memory Gap Gate
- Personal Context promotion
- query parsing schema
- candidate selection gate

## Integration

- upload
- Auth / RLS / user isolation
- Storage ownership
- AI invalid schema
- correction
- search
- cost gate
- deletion cascade（内部安全性として）

## E2E Hero

```text
Upload
→ Sequence
→ Event
→ Evidence
→ Memory
→ Gap
→ Confirmation
→ Search
→ Candidate Selection if needed
→ Grounded Answer
```

---

# 35. 実装順序

## Phase 0

- repository inspection
- IMPLEMENTATION_PLAN.md

## Phase 1

- Database migration
- Auth
- RLS
- Private Storage

## Phase 2

- upload
- validation
- hash
- EXIF / metadata

## Phase 3

- Temporal Sequence
- Event

## Phase 4

- AI adapter
- Vision
- Evidence
- Claim

## Phase 5

- Memory
- Context Completeness
- Memory Importance
- Memory Gap Detection

## Phase 6

- Confirmation Flow

## Phase 7

- Hybrid Retrieval
- Search Interpretation
- Candidate Selection
- Grounded Answer

## Phase 8

- Memory Thread UI
- Memory Detail UI
- Visual Grammar / Motion

## Phase 9

- Privacy & AI
- Loading / Empty / Error
- Accessibility
- Responsive

## Phase 10

- tests
- AI cost logging
- security review
- final UI review

Hero Flowが壊れた状態でOptional Featureへ進まない。

---

# 36. Code Quality

- 巨大な1 componentを作らない
- 巨大な1 serviceを作らない
- UI / domain / infrastructureの責務を分離
- `any`乱用禁止
- shared typeを定義
- duplicate code削減
- 過剰抽象化は避ける
- fake backend / dummy actionを残さない
- console errorを残さない
- TODOだけで完成扱いしない

---

# 37. Completion Criteria

最低限、以下が実際に動く。

- login / private workspace
- real image upload
- validation
- metadata extraction
- Sequence generation
- Event
- real AI analysis
- Evidence
- Claim
- Memory draft / active
- Context Completeness
- Memory Importance
- Memory Gap
- non-blocking confirmation
- User confirmed Claim
- natural language search
- AI query interpretation
- candidate selection
- grounded answer
- Memory Thread
- Memory Detail
- Privacy & AI settings
- Loading / Empty / Error
- smartphone responsive
- persistence after reload
- no hard-coded demo answer
- no console error
- no type error
- tests passing

完了時に `IMPLEMENTATION_REPORT.md` を作成し、以下を記載する。

- 実装済み
- 未実装
- 仮定
- Product Open Questions
- 技術的負債
- Security確認
- AI cost
- Test結果
- 次の開発者がやること
