# Codex Implementation Prompt — Memory Space UI

対象branch: `codex/ui-memory-evidence-secondary`

目的は、Memory Detailを「AI/Evidenceを読む画面」から「自分の過去に戻るMemory Space」へ近づけること。

## 最初に確認

- `git status`, `git diff`, current branch, `origin/main`との差分を確認する
- `docs/implementation/UI_MEMORY_SPACE_SCOPE.md` を読む
- 現在のMemory Detail / types / tests / CSSを読む
- Event Semantics / Distillation / RelationsのDomain/DBを作り直さない
- sibling backend branch `codex/backend-recall-engine` に依存しない

## 実装原則

情報階層を次にする。

```text
Memory
→ Photography
→ Time / Place
→ Narrative
→ Connected Moments
→ Ask about this moment
→ Evidence / Provenance
```

AIはHeroではない。ユーザーの過去がHero。

## 実装対象

1. Distillation済み代表3枚をMemory Sceneの中心にする
   - identityをprimary visual
   - key_moment / complementをsecondary visual
   - role名は原則UIに表示しない
   - 1/2枚・fallbackも崩れない

2. Time / Place / Narrativeを写真の直後に置く
   - metadata tableのように見せない
   - Memoryの体験を優先する

3. Connected MomentsをLocal Contextとして整理
   - before / same_place / same_activityを人間向け文言にする
   - global graphを作らない
   - relationの内部scoreを表示しない

4. AIをsecondary actionへ移す
   - 常設大面積chatを避ける
   - `この日のことを聞く` 等の導線にする
   - grounded answer機能自体は削除しない

5. Evidence / Claims / Provenanceをsecondary layerへ移す
   - accordion / details / bottom sheet等
   - 情報は削除しない
   - Evidence First / provenanceの追跡可能性を維持する

6. responsive / partial state
   - mobile 390px
   - desktop
   - no representative / 1-2 representative
   - no relations
   - loading / error

## 変更境界

原則変更可:

- `src/components/rememory/**`
- UI read-model typeの最小変更
- `app/globals.css`
- UI tests

原則変更禁止:

- `src/domain/**`
- AI Provider / prompt
- DB migration
- Search / Recall backend

もしBackend contract変更が必要なら、まずUI側adapterで吸収できないか検討し、不要なcross-branch変更を避ける。

## 非対象

- HomeのNOW全面改修
- RecallOpportunity
- CurrentContext
- fake trigger
- Search / Embedding
- global graph

## Definition of Done

- 画面を開いた瞬間に写真・時間・場所が最も強く見える
- Evidence / AIは必要時に到達できるが主役ではない
- 代表3枚がMemory compositionとして自然に見える
- Connected Momentsが人生の前後関係として読める
- Grounding / Correction / Provenance機能を失わない
- mobile / desktop / partial / failure testsが通る

## Verification

既存scriptsを確認し、最低限 lint / typecheck / unit/integration / relevant E2E / build を実行する。
実行できないものはPASSと書かない。

## 最終報告

- Before / Afterの情報階層
- 変更component
- Evidence / AIをどうsecondary化したか
- Connected Momentsの見せ方
- partial / failure state
- tests / commands / results
- Backend branchとの競合ファイル有無
