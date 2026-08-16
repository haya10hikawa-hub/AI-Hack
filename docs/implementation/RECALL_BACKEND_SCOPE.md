# Recall Backend — Implementation Scope

## Goal

現在の `Photos → Meaning → Memory` を、**Memoryを検索・再発見し、現在の文脈からRecallを生成できるBackend**へ拡張する。

今回の中心は次の4層。

```text
Memory Core
→ Memory Search Document
→ Hybrid Retrieval
→ Recall Engine
→ RecallOpportunity
```

UI branchとは直接依存しない。UI branchはこのBackendの完成を待たずに並行実装できる。

## Target architecture

```text
Event Semantics
+ Grounded Claims
+ User Confirmed Claims
+ Memory metadata
        ↓
Memory Search Document
        ↓
Structured / Full Text / Semantic Retrieval
        ↓
Recall Candidates
        +
CurrentContext
        ↓
Recall Engine
        ↓
RecallOpportunity
```

## In scope

### 1. Memory Search Document

1 Memoryにつき1つの決定論的検索表現を生成する。

最低限:

- memoryId
- title / summary
- capturedAt
- coarsePlace
- 7種Event Facets
- eligible active Claims
- user-confirmed context
- normalized searchableText
- version
- contentHash

同一grounded stateから常に同一Documentを生成する。

除外:

- unsupported
- disputed
- superseded
- deleted
- low-confidenceで検索根拠に不適切なClaim
- exact GPS
- raw EXIF
- storage path
- user identity

### 2. Projection更新

以下でSearch Documentを更新する。

- Memory reconstruction完了後
- User Correction後
- Searchに影響するgrounded state変更後

Projection更新失敗はMemory本体・Correctionを失敗させない。

### 3. Hybrid Retrieval

責務を分離する。

- Structured: date / coarse place / state / confirmed context
- Full Text: 固有語・略称・Exact Match
- Semantic: 曖昧な意味・文脈

既存grounded answer pathを維持し、Vector-only searchへ置換しない。

### 4. Embedding

実装可能なら `1 Memory = 1 Vector`。

- photo-level embeddingは禁止
- Provider portを分離する
- `searchableText`だけをEmbedding対象にする
- model / dimensions / contentHashを保持可能にする
- same hashなら再生成不要
- provider failureはMemory本体へ波及させない

Provider / pgvectorが現在の環境で安全に検証できない場合は、Search Document + Embedding Provider interfaceまでを優先し、未検証のfake vector pathは作らない。

### 5. CurrentContext

Recall Engineへの入力として、明示的なContext型をDomainに作る。

最低限:

```text
CurrentContext
- now/date
- coarsePlace?
- activities?
- explicitQuery?（既存検索と統合する場合）
```

今回はbackground location trackingやpush収集を実装しない。
Contextは呼び出し元から明示的に渡される前提でよい。

### 6. Recall Engine

`CurrentContext × Memory Candidates` から、決定論的にRecall候補を評価する。

MVP trigger reason:

- same_period
- same_place
- same_activity
- explicit_query（既存検索との接続が自然な場合のみ）

概念スコア:

```text
RecallScore
= TemporalRelevance
+ PlaceRelevance
+ ActivityRelevance
+ MemorySalience
+ RelationStrength
- RepetitionPenalty
```

重みはDomain定数として明示し、同じ入力から同じ結果を返す。
AIに「どのMemoryを今見せるか」の最終決定を丸投げしない。

### 7. RecallOpportunity

Backend出力として、UIに依存しないDomain/API contractを作る。

最低限:

```text
RecallOpportunity
- memoryId
- triggerType / reasons[]
- score（内部用）
- createdAt
- expiresAt?（必要なら）
- representative summary / minimal read model
```

ユーザー向けUIにはraw numeric scoreを表示しない前提。

### 8. Recall API / service boundary

必要なら専用Route Handlerを追加する。

例:

```text
POST /api/recall/opportunities
CurrentContext
→ bounded candidates
→ Recall Engine
→ top opportunities
```

Route Handlerにbusiness logicを置かず、Domain / Server Serviceへ分離する。

## Out of scope

- HomeのNOW UI
- push notification
- background location tracking
- global Memory Graph
- Graph DB
- photo-level embedding
- face recognition
- AI semantic relations
- UI全面改修

## Parallel-work boundary

UI branch `codex/ui-memory-evidence-secondary` と**直接依存しないSibling branch**として進める。

担当範囲:

- `src/domain/**`
- `src/server/**`
- recall/search API route / service
- Supabase migration / RPC / indexes（必要な場合のみ）
- backend tests

変更しない:

- `src/components/rememory/memory-detail-screen.tsx`
- UI layout
- `app/globals.css`

UI branchとの共有型が必要な場合も、UI componentを変更せずAPI contract側で完結させる。

## Common baseline rule

このbranchとUI branchは互いにstackしない。

両方とも、Event Semantics / Distillation / Relationsが入った**同一Memory Core baseline**を前提とする。

もしそのMemory Coreがローカルworking treeにのみ存在しremote mainへ未反映なら、実装開始前に共通baseline commitを確定し、両branchへ同一commitを取り込むこと。片方のfeature branchをもう片方のbaseにしない。

## Definition of Done

- Memory Search Documentがgrounded stateから決定論的に生成できる
- Correction後もprojectionが更新される
- exact GPS等の禁止情報を含まない
- Structured / Full Text / Semanticの責務が分離される
- Semanticを実装してもvector-only searchへ置換しない
- CurrentContext型が存在する
- Recall Engineがbounded candidatesから決定論的にRecallOpportunityを生成する
- same_period / same_place / same_activityをテストする
- projection / embedding / recall生成失敗がMemory本体を壊さない
- Home UIなしでもBackend contractとして単体・integration test可能
