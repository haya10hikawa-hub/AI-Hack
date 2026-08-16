# Memory Space UI — Implementation Scope

## Goal

Memory Detailを「データ詳細」ではなく「その日に戻るMemory Space」へ近づける。

今回の中心は **Evidence / AIを後ろへ下げ、Memoryそのものを前面へ出すこと**。

## Product principle

```text
Memory
→ Photography / Time / Place / Narrative
→ Connected Moments
→ Ask about this moment
→ Evidence / Provenance
```

AIはHeroではない。ユーザーの過去がHero。

## In scope

1. Memory Detailの情報階層を再構成
   - Photography
   - Time
   - Place
   - Narrative
   - Connected Moments
   - AI
   - Evidence / Provenance

2. Distillation済み3枚をMemory Sceneの中心にする
   - identity: primary visual
   - key_moment / complement: secondary visuals
   - 内部role名は原則ユーザーに表示しない

3. Evidence / Claims / provenanceをsecondary layerへ移動
   - details / accordion / bottom sheet等
   - 情報を削除しない
   - 必要時に追跡可能であること

4. AI UIを補助導線へ変更
   - 常時主役にしない
   - 「この日のことを聞く」等のsecondary action

5. Connected MomentsをLocal Contextとして整理
   - global graphは作らない
   - before / same_place / same_activityを人間向け表現で表示

6. responsive / loading / partial / failure statesを維持

## Out of scope

- HomeのNOW全面改修
- RecallOpportunity / CurrentContext
- fake trigger
- global graph
- backend search / embedding
- DB再設計
- Distillation / Relationsロジック再実装

## Parallel-work boundary

Backend branch `codex/backend-recall-engine` と競合しないよう、原則として以下に限定する。

- `src/components/rememory/**`
- UI read-model typeの最小変更
- `app/globals.css`
- UI tests

Domain / AI / DB / Search pipelineを変更しない。

## Definition of Done

- Memory Detailを開いた瞬間に写真・時間・場所が支配的に見える
- Evidence / AIはsecondary interactionで到達できる
- 3代表画像が自然なMemory compositionとして表示される
- Connected Momentsが現在Memoryの文脈として読める
- 既存Grounding / provenance情報を失わない
- mobile / desktop / loading / partial / failureをテストする
