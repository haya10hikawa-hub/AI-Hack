# Recall-ready Backend — Implementation Scope

## Goal

現在の `Photos → Meaning → Memory` を、次の Recall Phaseへ接続できるBackendへ拡張する。

今回の中心は **Memory Search Document / Hybrid Retrieval / Recall-ready projection**。

## Target architecture

```text
Event Semantics
+ Grounded Claims
+ User Confirmed Claims
+ Memory metadata
        ↓
Memory Search Document
        ↓
Structured / Full Text / Semantic retrieval
        ↓
Recall candidate foundation
```

## In scope

1. Memory Search Document
   - 1 Memoryにつき1つの決定論的検索表現
   - title / summary / capturedAt / coarsePlace
   - 7種Event Facets
   - eligible active Claims
   - user-confirmed context
   - normalized searchable text
   - version / content hash

2. Pure Domain builder
   - 同一grounded stateから同一Document
   - unsupported / disputed / superseded / deleted / low-confidenceを除外
   - exact GPS / raw EXIF / storage path / user identityを含めない

3. 更新フロー
   - Memory reconstruction後
   - User Correction後
   - relevant grounded state変更後
   - projection更新失敗はMemory本体へ波及させない

4. Hybrid Retrieval foundation
   - Structured: date / coarse place / state / confirmed context
   - Full Text: 固有語・略称・Exact Match
   - Semantic: 曖昧な意味検索
   - 既存grounded answer pathを維持

5. Embedding
   - 実装する場合は `1 Memory = 1 Vector`
   - photo-level embeddingは禁止
   - Provider portを分離
   - provider / pgvectorが不安定ならinterface + Search Documentまでを優先

6. Recall-ready extension
   - 将来 `CurrentContext × Memory → RecallOpportunity` に接続できるAPI/domain境界を壊さない
   - 今回は proactive trigger 自体は実装しない

## Out of scope

- HomeのNOW UI
- push / location background tracking
- global Memory Graph
- Graph DB
- photo-level embedding
- face recognition
- AI semantic relations
- UI全面改修

## Parallel-work boundary

UI branch `codex/ui-memory-evidence-secondary` と競合しないよう、原則として以下を担当する。

- `src/domain/**`
- `src/server/**`
- search route / service
- Supabase migration / RPC / indexes（必要な場合のみ）
- backend tests

`memory-detail-screen.tsx`、UI layout、`app/globals.css`は変更しない。

## Definition of Done

- Memory Search Documentがgrounded stateから決定論的に生成できる
- Search projectionがCorrection後も更新される
- exact GPS等の禁止情報を含まない
- Structured / Full Text / Semanticの責務が分離される
- Semanticを実装した場合もvector-only検索に置換しない
- projection / embedding失敗がMemory本体を壊さない
- 将来RecallOpportunityへ自然に接続できる
