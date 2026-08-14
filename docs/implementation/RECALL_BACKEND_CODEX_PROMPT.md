# Codex Implementation Prompt — Recall Backend

対象branch: `codex/backend-recall-engine`

目的は、現在の `Photos → Meaning → Memory` を、`Memory → Retrieval → RecallOpportunity` まで進めること。

## 最初に確認

- `git status`, `git diff`, current branch, `origin/main`との差分を確認する
- `docs/implementation/RECALL_BACKEND_SCOPE.md` を読む
- Event Semantics / Evidence / Claims / Relations / Searchの既存実装を読む
- sibling UI branch `codex/ui-memory-evidence-secondary` に依存しない
- UI component / CSSを変更しない

## 実装原則

```text
Memory Core
→ Memory Search Document
→ Hybrid Retrieval
→ CurrentContext
→ Recall Engine
→ RecallOpportunity
```

AIは意味理解・補助rerankには使えても、最終Recall生成の根拠はgrounded stateと決定論的Domain Logicで説明可能にする。

## 1. Memory Search Document

Pure Domain builderを作る。

入力:

- Memory metadata
- Event Semanticsの7種Facet
- active Grounded Claims
- User Confirmed Claims

最低出力:

```text
memoryId
capturedAt
coarsePlace
title
summary
activities[]
objects[]
peopleGroups[]
environments[]
moments[]
details[]
visibleTexts[]
groundedClaims[]
searchableText
version
contentHash
```

除外:

- unsupported / disputed / superseded / deleted
- low-confidenceで検索根拠に不適切な情報
- exact GPS / raw EXIF / storage path / user identity

同じgrounded stateから同じDocument/hashを生成する。

## 2. Projection更新

以下で更新:

- Memory reconstruction後
- User Correction後
- relevant grounded state変更後

projection更新失敗はMemory/Correctionをrollbackしない。

## 3. Hybrid Retrieval

既存Searchを破壊せず責務分離する。

```text
Structured = date / coarse place / state / confirmed context
Full Text  = 固有語 / 略称 / exact terms
Semantic   = 曖昧な意味 / 文脈
```

Vector-only searchへ置換しない。

## 4. Embedding

安全に実装可能なら `1 Memory = 1 Vector`。

- `searchableText`だけを埋め込む
- photo-level vectorは禁止
- Provider portを作る
- model / dimensions / contentHashを追跡する
- same hashなら再生成不要
- provider failureは派生処理失敗として隔離

pgvector/providerを実環境で検証できない場合、fake implementationを作らずinterface + deterministic Search Documentを完成させることを優先する。

## 5. CurrentContext

Domain型を作る。

```text
CurrentContext
- now/date
- coarsePlace?
- activities?
- explicitQuery?
```

background trackingは実装しない。呼び出し元から明示的に渡されるContextのみ扱う。

## 6. Recall Engine

bounded candidate Memoriesに対してPure Domainで評価する。

理由:

- same_period
- same_place
- same_activity
- explicit_query（自然に既存Searchと統合できる場合）

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

重み・閾値・tie-breakをコード定数として明示し、同じ入力から同じ結果を返す。

重要:

- 全Memory O(N²)比較をしない
- candidate generationを先に行う
- unknown contextを無理に補完しない
- numeric scoreは内部用

## 7. RecallOpportunity

UI非依存contractとして作る。

最低限:

```text
memoryId
reasons[]
triggerType
score (internal)
createdAt
expiresAt? (必要なら)
minimal Memory preview
```

必要なら `POST /api/recall/opportunities` のようなRoute Handlerを追加する。
Routeにbusiness logicを置かずService/Domainへ分離する。

## 8. Failure isolation

以下の失敗でMemory本体を壊さない:

- Search Document projection
- Embedding
- Semantic retrieval
- Recall generation

Structured fallback / empty opportunityを安全に返せること。

## 9. Tests

必須:

- Search Document deterministic
- duplicate facet removal
- disputed/unsupported/low-confidence除外
- user-confirmed反映
- exact GPS等禁止情報の非混入
- Correction後hash/document更新
- same_period / same_place / same_activity
- unknown contextで捏造しない
- deterministic tie-break
- bounded candidate count
- provider/vector failure isolation
- cross-user retrieval禁止
- RecallOpportunity API contract

## 変更境界

原則変更可:

- `src/domain/**`
- `src/server/**`
- search / recall Route Handler
- 必要最小限のSupabase migration/RPC/index
- backend tests

変更禁止:

- `src/components/rememory/memory-detail-screen.tsx`
- UI layout
- `app/globals.css`

## 非対象

- Home NOW UI
- push notification
- background location
- global graph
- Graph DB
- photo-level embedding
- face recognition
- AI semantic relations

## Verification

既存scriptsを確認し、最低限 lint / typecheck / unit/integration / DB tests / relevant E2E / build / `git diff --check` を実行する。
mockとlive verificationを明確に区別する。

## 最終報告

- Search Document schemaと生成元
- Projection更新条件
- Structured / Full Text / Semanticの実装範囲
- Embedding実装有無と理由
- CurrentContext / RecallOpportunity contract
- Recall scoring / candidate bound / tie-break
- failure isolation
- DB変更
- tests / commands / results
- live未検証項目
- UI branchとの競合ファイル有無
