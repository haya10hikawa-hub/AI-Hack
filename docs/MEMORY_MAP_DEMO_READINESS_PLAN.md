# Memory Exploration Map — Demo Readiness Plan

## 2026-08-14 P0 implementation pass

Application-side P0 implementation is complete on `codex/memory-exploration-map-mvp`:

- 520ms success-only Fog Reveal with delayed Memory node and reduced-motion fallback
- 390px single-column Hero and 1440px Map 2/3 + Detail 1/3 composition
- 22px Memory node, non-color state hierarchy, selected ring / scale / depth
- owner-scoped, resolution-validated Cell → Recall candidate filtering
- distinct denied / unavailable / timeout handling with saved-Map fallback
- local-only deterministic seed command with Passed ×1、Experienced ×1、Memory ×2 and two evidence-linked Memories

Quality gates passed with 108 Vitest tests and 26 Playwright tests. The local demo seed, migration reset, and pgTAP remain unexecuted because OrbStack/Docker is not running on the validation machine. Do not mark the recording environment DEMO READY until the commands below pass locally.

```bash
pnpm dlx supabase@latest start
pnpm dlx supabase@latest db reset
pnpm dlx supabase@latest test db
pnpm demo:map:seed
pnpm dev
```

The fixed local recording login is printed by `pnpm demo:map:seed`. Re-running the seed command deletes and recreates only that local demo account.

## 目的と判定

この文書は、Memory Exploration Mapを「実装提案」から「AI HACK 2026の3分デモ動画で、30〜40秒のHero Flowとして安定して見せられる状態」へ引き上げるための改善計画である。アプリコードの変更はこの文書の対象外とし、現在のコードをSource of Truthとして評価する。

調査時点: 2026-08-14

- latest `main`: `3c8e8d9`（PR #30までmerge済み）
- 対象branch: `codex/memory-exploration-map-mvp` / `def2b34`
- Draft PR: [#29 Memory Exploration Map MVP — Area × Memory × Recall](https://github.com/haya10hikawa-hub/AI-Hack/pull/29)
- Related Issue: [#27 Memory Exploration Map](https://github.com/haya10hikawa-hub/AI-Hack/issues/27)
- PR #29は調査時点でopen / draft / unmerged。対象branchはlatest mainより後から入ったlegal/onboarding文書をまだ含まないため、実装再開前にmainを取り込み、競合と同意文言を再確認する。

## Executive assessment

現在のMapは、プライバシー境界、H3変換、永続化、RLS、基本的なMap→Memory導線まで備えた「機能するPhase 1基盤」である。一方、動画のWOW Moment、デモデータ準備、GPS失敗時の復旧、本当にcellを使うRecall、実データからMemoryとcellを結ぶproduction経路が未完成であり、現状のままでは **DEMO READYではない**。

| 観点                 | 評価 | 根拠                                                                                                                                                                                                                           |
| -------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functional Readiness | 7/10 | Map表示、明示操作のGeolocation、端末内H3変換、cell保存・reload、保存済みlinkからMemory表示、Memory Detail遷移は実装済み。ただしproductionでMemoryとcellを作る導線がなく、Searchは`q`だけを読み、`cellId`を検索条件に使わない。 |
| Visual Readiness     | 5/10 | Unknown / Passed / Experienced / Memoryはtexture、border、nodeでも区別しているが、Reveal animationがなく、Memory nodeは12px、空状態のFogは7cellだけで、動画上の状態変化が弱い。                                                |
| Demo Readiness       | 4/10 | E2E fixtureでは安定するが、3〜6地域を準備するseed/setupがなく、実GPS・実DB・Memory linkに依存すると撮影失敗率が高い。30秒で魅力を見せる演出も未実装。                                                                          |
| Privacy Readiness    | 9/10 | exact GPSはGeolocation callback内でH3へ変換され、APIはstrictな`cellId`のみ、DBにlat/lng/path列なし、LLM・外部tile呼び出しなし。H3 cellも位置情報であり匿名ではない点をUIでもさらに明瞭にできる。                               |
| Reliability          | 6/10 | loading、empty、API error、offline、permission denied、unsupported、reload、390px/desktop E2Eはある。GPS error codeを無視するためtimeout/unavailableがdenied表示になり、network latency中のReveal表現と撮影用fallbackが弱い。  |

## 現在の実装で確認できたこと

### Functional Readiness

- `app/map/page.tsx`は`MemoryMapScreen`を表示し、AppShellのdesktop / bottom navigationにMapが5番目の主導線として存在する。
- 「現在地を使う」を押した時だけ`navigator.geolocation.getCurrentPosition`を呼び、`coordinatesToMemoryMapCell`がH3 resolution 10へ変換する。
- `/api/map` POSTはstrict body、最大1,024 bytes、same-origin、session user、H3 validity / resolutionを検証し、service-only RPCへ`cellId`だけを渡す。
- `memory_map_cells`は`(user_id, cell_id)` uniqueで、同一cell再訪はrowを増やさず`visit_count`と`last_seen_at`を更新する。
- GETは保存済みcellを返すためreload後も残る。500cellで部分取得表示になる。
- `memory_map_cell_memories`に正当なlinkが存在すればactive Memoryをcell detailへ表示し、Memory Detailへ移動できる。
- Cell DetailのCTAは`/search?q=この辺で何してた？&cellId=...`へ移動する。ただしSearch画面は現在`q`だけをprefillし、`cellId`を検索APIやRecall contextへ渡していない。見た目のhandoffは成立するが、場所で検索を限定する実接続ではない。
- 既存の`coarse_place`は推測でH3 cellへ配置せず、別のaccessible listへ表示する。このtruth boundaryは維持すべきである。

### State model

Issue #27の概念は次の4段階である。

```text
░ Unknown
↓
▒ Passed
↓
▓ Experienced
↓
█ Memory
```

永続化する状態は`passed | experienced | memory`で、Unknownは「DB rowがない周辺cell」として描画する。domainには単調昇格関数があり、Reveal RPCは既存の上位状態を降格させない。Memory link追加時は`memory`へ昇格する。

未完成なのは、`passed -> experienced`を写真・dwell・user actionなどのEvidenceから昇格するproduction serviceと、Memory生成時に`memory_map_cell_memories`へ正当にlinkするproduction経路である。デモではこの欠落をfake自動推論で埋めてはならない。

### Privacy and security

非交渉条件は現在の実装と一致している。

```text
ブラウザ位置情報
↓
一時的 exact GPS
↓
端末内で H3 resolution 10へ変換
↓
exact GPSを破棄
↓
cellIdだけBackendへ送信
```

Backend / DB / AI / Analyticsへ次を送らない。

- exact latitude
- exact longitude
- GPS path
- second-by-second position

H3 cellは匿名情報ではない。resolution 10は平均辺長約76m、幅がおおむね100〜200mの位置情報であり、ここで行っているのは匿名化ではなくデータ最小化である。外部地図tile、reverse geocoding、LLMはMap描画に使わず、現在のMap描画の **LLM cost = 0** を維持する。

RLSは両Map tableをowner read-onlyにし、authenticated clientの直接writeを禁止する。Revealはservice roleだけが実行でき、server routeはsession userを`p_user_id`に固定する。account / Memory削除はforeign key cascadeでMap dataへ追従する。これらは静的契約・route・E2Eテストで覆われるが、local Supabaseのmigration / pgTAPはDocker起動後に実行が必要である。

## Re:MemoryにおけるMapの役割

Re:Memoryの入口は4つの軸で整理する。

```text
時間 → Memory Thread
言葉 → Recall / Search
場所 → Memory Exploration Map
未来 → Memory Opportunity
```

Mapは「行動履歴を見る場所」ではない。

> 場所を入口として、自分のMemoryを思い出す。

したがって、移動の線、現在位置の常時追跡、秒単位の滞在、一般地図の詳細情報を主役にしない。主役は「自分のEvidenceがある場所だけ解像度が上がり、そこからMemoryへ戻れること」である。

## Hero Concept

# 生きた場所だけ、世界がひらく。

最初の画面で説明カードよりFog of Memoryを大きく見せる。Minecraftそのもののpixel artや配色は模倣せず、Re:Memory既存のindigo / sage / coral、柔らかなsurface、丸いnode、静かなdepthを使う。

状態差は色だけに依存しない。

| State       | opacity | texture         | border           | node / depth                       | motion                |
| ----------- | ------- | --------------- | ---------------- | ---------------------------------- | --------------------- |
| Unknown     | 低い    | 細かなfog grain | dotted /薄い     | nodeなし、奥                       | 静止                  |
| Passed      | 中低    | 斜線を薄く      | dashed           | nodeなし                           | reveal時にfogが薄れる |
| Experienced | 中高    | 面が明瞭        | sage 2px solid   | 小さなopen node                    | 450msで浮かぶ         |
| Memory      | 高い    | clean surface   | indigo 2px solid | 20〜24px filled node + soft shadow | nodeが遅れて現れる    |
| Selected    | 高い    | stateを維持     | 3px focus ring   | detailと接続するdepth              | 150〜200ms scale      |

## Hero Flow target（30〜40秒）

### Scene 1 — Mapを開く

- First Viewに「生きた場所だけ、世界がひらく。」と広いFog Gridを表示する。
- 位置利用の説明はHeroを押し下げる大きなgateではなく、主CTA直下の短いprivacy captionにする。
- 3〜6地域のうち一部は既に開き、周囲のUnknownが十分残っている構図にする。

### Scene 2 — 現在地を使う

- CTAは「現在地を使う」。44px以上、390pxでは親指が届くHero直下に置く。
- UI上で短く「端末内で約150mの地域へ変換・正確な位置は保存しません」と示す。
- 内部処理はexact GPS → H3 cell → exact GPS破棄 → cellIdだけPOSTを維持する。

### Scene 3 — FogからReveal

- POST成功直後、対象cellを新規Reveal対象として識別する。
- 300〜700msの範囲、推奨520msで次を重ねる。
  1. 周囲fog overlayのopacityを`1 -> 0.35`へ下げる。
  2. cellを`scale(0.94) -> scale(1)`、opacityを`0.45 -> 1`へ変える。
  3. borderをdottedからstate固有へ変える。
  4. Memory stateならnodeを80ms遅らせて表示し、soft glowを一度だけ収束させる。
- 演出は一度だけでループさせない。`prefers-reduced-motion: reduce`ではtransitionを無効化し、即時にstateとstatus textを更新する。
- API待ち中はcellを変えずCTAをloadingにする。成功前にRevealしたように見せない。

### Scene 4 — Memory Cellを選ぶ

Detailの情報順を固定する。

1. `神山周辺`
2. `3回の訪問 · 2件のMemory`
3. `FTC練習`
4. `学校イベント`
5. Memory Detail link

Memory nodeは動画の1080p縮小後も判別できる20〜24pxを目安にし、selected cellは色だけでなくfocus ring、2〜3% scale、detail headingとの対応で明確にする。

### Scene 5 — Recallへ接続

- CTAはprimary寄りの視覚優先度で「この辺の記憶を探す」。
- Searchへ`q`だけでなくvalidated `cellId`をRecallContextとして渡し、検索APIがそのuser-owned cellにlinkされたactive Memory IDsへ候補を限定またはboostする。
- LLMへcell IDや座標を直接渡さず、server側のdeterministic retrievalでMemory候補を作った後、通常のgrounded Recallへ渡す。

## Reveal Animation implementation note

最小実装は`recentlyRevealedCellId`を一時的なclient stateとして保持し、resource reload後に同じcellへ`is-revealing` classを約700ms付ける。exact GPSは保持せずcell IDだけを使う。CSS keyframesはopacity、transform、box-shadowだけに限定し、layout shiftを起こさない。

```css
@media (prefers-reduced-motion: no-preference) {
  .fog-cell.is-revealing {
    animation: memory-cell-reveal 520ms ease-out both;
  }
}
```

周辺fog fadeは擬似要素のopacity変更に留め、隣接cellを「訪問済み」に昇格させない。視覚効果とtruth stateを分離する。

## Demo用Mapデータ

### 選択肢比較

| 方式                                    | 安全性 | 再現性 | 実装量 | 判定                                                                       |
| --------------------------------------- | ------ | ------ | ------ | -------------------------------------------------------------------------- |
| production codeへのFake Memory hardcode | 低     | 高     | Low    | 禁止。truth boundaryと本番挙動を壊す。                                     |
| E2E route fixtureだけを録画             | 中     | 高     | Low    | UI確認には有効だが、本番相当DB・RLS・reloadを示せない。                    |
| 手作業でDBへinsert                      | 中     | 低     | Low    | 操作ミス、user ID間違い、再現不能が起きやすい。                            |
| local-only deterministic seed           | 高     | 高     | Medium | 推奨。RLS schemaと実画面を通し、毎回同じ状態を再構成できる。               |
| demo setup scriptで専用accountへ投入    | 高     | 高     | Medium | hosted previewで撮影する場合の第二候補。明示env guardと専用accountが必須。 |

### 推奨方式

`supabase/seed.demo.sql`または型付き`pnpm demo:seed:map`を追加し、専用demo userにだけ次を作る。

- Passed × 1
- Experienced × 1
- Memory × 2
- 任意のUnknown周辺cell（DBには保存せず描画で生成）
- `神山周辺`、訪問3回、Memory 2件
- active Memory: `FTC練習`、`学校イベント`

条件:

- production buildでは実行不能にする。`DEMO_FIXTURES=true`かlocal Supabase URLを必須にする。
- 実在ユーザーのデータを上書きしない専用UUID / emailを使う。
- 既存Memory schema、Evidence / Claim invariant、cell-memory foreign keyを通す。
- 冪等upsertとcleanupを用意し、seed → reload → resetを1コマンドで再現できる。
- exact lat/lngをseedへ入れない。レビュー済みH3 cell IDだけを使う。
- 撮影前に`db reset`、seed、login、Map reload、Memory detail、Recallを一度通す。

## Map UI改善案

### First View

- 現在のprivacy gateがMapより先に大きく見える構成を改め、Hero copy → Fog Grid → CTA → 1行privacy captionの順にする。
- Map無効時もFog Heroを表示し、CTAの初回操作で有効化同意を明確に取る。設定説明を主役にしない。

### Fog

- 空状態の7cellから、390pxで最低19〜37cell程度が画面に見える構図へ広げる。
- explored islandを中央から少し外し、Unknownが周囲に続く余白を作る。
- background grainとcell textureのコントラストを調整し、Unknown cellの境界は見えるが情報量は低くする。

### Memory Node

- 12pxから20〜24pxへ拡大し、filled node、2px ring、soft shadowを組み合わせる。
- Memory数が複数でもbadgeの数字を主役にせず、Detailで件数を読む。

### Selection

- selected stateはfocus ring、微細なscale、elevation、`aria-pressed`を併用する。
- keyboard focusとselectedを区別しつつ、どちらも十分なcontrastを持たせる。

### Cell Detail

- 地域、訪問回数、Memory数、Memoryタイトルを最上段へ置く。
- state説明や内部cell IDはデモ画面に出さない。
- 390pxではMap直下のbottom sheet風section、desktopではMap横のdetail panelを提案する。

### CTA

- 「この辺の記憶を探す」をDetailの最も強いactionにする。
- Memory Detail linkとRecall CTAの役割を分け、最低44pxのtap targetを保証する。

## Responsive target

### Mobile — 390px最優先

- horizontal overflowをPlaywrightで`scrollWidth <= clientWidth`として検証する。
- Bottom Navigationのsafe-area込み高さを確保し、最後のCTA / resetが隠れないことを確認する。
- Hero Mapは最低390〜440px高を維持し、First ViewでMapの上半分とCTAが見える構成にする。
- すべての主要CTAとcell tap targetを44px以上にする。
- Detailは1列、Memory titleは2行まで、地域名と件数をCTAより先に読む。
- Map CTAを画面下寄りに置き、片手の親指で操作可能にする。

### Desktop — 1440px

- 現在の最大幅約68remを、Heroでは72〜80rem程度まで使う案を比較する。
- 小さなcardを中央に置くのではなく、Map 2/3 + Detail 1/3のsplit layoutにし、Fog GridをHero Visualとして成立させる。
- desktop navigation、Hero heading、Mapの左端を揃え、空白を意図的なdepthとして使う。

## Demo Failure対策

| Failure              | 現状                          | Demo-ready対応                                                                                              |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Permission denied    | 保存済みMapを維持しnotice表示 | 事前にbrowser permissionを確認。拒否時は「保存済みの世界を見る」CTAを出し、seed済みMemory cellへfocusする。 |
| GPS timeout          | deniedと同じ表示              | Geolocation error code 3を判定し「時間内に取得できませんでした。再試行」を表示する。                        |
| Position unavailable | deniedと同じ表示              | error code 2を別表示し、保存済みMapへ戻す。                                                                 |
| API error            | error notice                  | cellを成功状態へ先行変更しない。Retry CTAと保存済みMap継続を保証する。                                      |
| Map empty            | 7cell + empty copy            | 広いFogと「最初の地域をひらく」を見せる。撮影accountはseed済みにする。                                      |
| Memoryなし           | 説明文のみ                    | Passed / Experiencedとして正直に表示し、Memoryがない理由を短くする。                                        |
| refresh              | DBから復元                    | selected cellをURL queryまたは最初のMemory cellへdeterministicに復元する案を採用する。                      |
| network latency      | CTA loading                   | 10秒上限、loading label、二重submit防止、timeout後のretryをテストする。                                     |

### 本番デモでGPSが取れない場合のFallback Plan

1. 撮影前日に専用demo accountへ3〜6地域をseedし、Map、Memory Detail、Recallを確認する。
2. 撮影ブラウザのlocation permissionとsecure originを確認し、同じ場所でテストtakeを1本保存する。
3. 本番takeでGPSが失敗したら連打しない。保存済みMapへ切り替え、「正確な位置を保存せず、以前ひらいた地域は残ります」と説明する。
4. seed済みMemory cellを選び、Scene 4〜5を続行する。GPS成功を偽装するproduction fallbackは作らない。
5. 動画提出では成功takeを使う。live審査用には同じ専用accountと、GPSなしでも完走できる保存済みMap経路を準備する。

## AIとの役割分担

### Deterministic — Submission MVP

- H3変換とvalidity / resolution検証
- cell relation / grid geometry
- stateと単調昇格
- owner filteringとMemory link
- distance（必要になった場合も通常コード）
- search candidate filtering
- Reveal animation trigger

### AI — 将来に限定

- Opportunityと現在のMemory contextのsemantic relevance
- 候補の短い説明
- grounded Memory Recall

Map表示、Fog、distance、cell relation、state判定のためにLLMを呼ばない。**Map描画コスト: LLM cost = 0**をAcceptance Criteriaへ含める。

## Submission MVPとPhase 2

### Submission MVP

- 保存済みH3 cellのFog Map
- 明示操作時だけのon-device H3変換
- Passed / Experienced / Memoryの視覚差
- production-validなcell-memory link経路
- Fog → Reveal animation
- Cell → Memory Detail
- Cell-scoped Recall handoff
- local-only demo seed
- permission / timeout / API failure fallback

### Phase 2 — Memory Opportunity

- 100〜400mのadaptive radius
- optional POI candidate provider
- novelty、context、preference、detour costによるranking
- Opportunity semantic relevanceと説明
- dismiss / reduce / opt-out
- safety rule、quiet hours、frequency cap
- native background location、push notification（別Issue・threat model・明示同意が必須）

Submission MVPではPOI API、AI観光推薦、background GPS、push通知を実装しない。Opportunity型が存在しても、未訪問候補をMemory truthへ昇格させない。

## 実装優先順位とUsage Budget

現在のweekly usage残量約71%に対し、Map改善の上限を20〜30%とする。P0完了時点で再評価し、P1を全投入しない。Costは相対的なCodex作業量である。

### P0 — Demo動画前に必須（最大5項目）

| 項目                            | 完了条件                                                                                            | Cost        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| 1. Fog → Reveal WOW Moment      | 520ms前後の一度だけの演出、成功後だけ発火、reduced motion対応、動画で状態変化が判別可能             | Medium      |
| 2. deterministic demo seed      | Passed ×1、Experienced ×1、Memory ×2、3〜6地域、2件の実schema Memoryを1コマンドで再現・cleanup可能  | Medium      |
| 3. Hero-first responsive layout | 390pxで広いFog、44px CTA、Bottom Nav非衝突、1440pxでMapがHero Visualになる                          | Medium      |
| 4. Cell-scoped Recallの実接続   | URLのvalidated cellIdをserverでowner確認し、linked active Memoryへdeterministicに絞ってRecallへ渡す | Medium      |
| 5. デモ失敗耐性                 | denied / unavailable / timeoutを分離し、retryと保存済みMap fallbackをE2Eで確認                      | Low〜Medium |

P0の目安消費は15〜22%。ここでDEMO READY判定を行い、残量をHero Flow全体、production、bug fix、動画、submissionへ温存する。

### P1 — Submission前にやる

| 項目                          | 完了条件                                                                           | Cost   |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Memory-cell production link   | 写真のprivacy-safe derivativeまたは明示user actionから、Evidenceを保ったlinkを作る | High   |
| Experienced昇格               | 写真 / Event / repeated visit等の明示ルールをdomain serviceとtestで固定            | Medium |
| local Supabase実機検証        | latest main取り込み後にdb reset、migration、pgTAP、User A/B、cascadeを完走         | Low    |
| Visual / accessibility polish | contrast、keyboard、focus、overflow、screen reader list、実機390px確認             | Medium |
| 撮影チェックリスト            | seed、権限、network、screen size、console、成功take、fallbackを文書化              | Low    |

P1はP0後の残量とSubmission全体の未完了項目を比較し、最大8%程度に制限する。特にHigh項目はMap外のHero Flowを圧迫する場合、Submission後へ送る。

### P2 — Submission後

| 項目                      | 完了条件                                                                    | Cost |
| ------------------------- | --------------------------------------------------------------------------- | ---- |
| Memory Opportunity engine | candidate density、100〜400m radius、novelty、repetition penalty、安全規則  | High |
| optional POI provider     | provider dataをMemory truthと分離し、未設定fallbackを持つ                   | High |
| AI relevance              | bounded candidateだけを対象にsemantic ranking、cost / timeout / auditを実装 | High |
| native/background         | local-first cell aggregation、明示permission、battery / threat model        | High |
| Map aggregation / zoom    | 多数cellをcoarse aggregationしprivacyとperformanceを再評価                  | High |

## Memory Map 30-second Demo Script

| 時間     | 操作                              | 画面                                                                | ナレーション                                                          |
| -------- | --------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0〜5秒   | Bottom Navigationの「地図」を開く | 広いFogと「生きた場所だけ、世界がひらく。」                         | 「Re:Memoryは、時間や言葉だけでなく、場所からも記憶を思い出せます。」 |
| 5〜10秒  | 「現在地を使う」を押す            | 端末内変換の短い表示、CTA loading                                   | 「正確な現在地は端末内で約150mの地域に変換し、保存しません。」        |
| 10〜15秒 | Revealを待つ                      | 対象cellのFogが520msで晴れ、Passed / Experiencedへ変化              | 「自分が生きた場所だけ、世界が少しずつひらきます。」                  |
| 15〜22秒 | Memory nodeのcellを選ぶ           | 「神山周辺」「3回の訪問」「2件のMemory」「FTC練習」「学校イベント」 | 「記憶がある場所では、その地域で何をしていたかが見えます。」          |
| 22〜27秒 | 「この辺の記憶を探す」を押す      | cell-scoped Recallへ移動                                            | 「場所を入口に、その時のMemoryへ戻れます。」                          |
| 27〜30秒 | grounded result / Memoryを開く    | Evidenceを持つMemory Detail                                         | 「行動履歴ではなく、人生の記憶の地図です。」                          |

## Acceptance Criteria — DEMO READY

以下をすべて満たした時だけ **DEMO READY** とする。

- [ ] Map Heroと「生きた場所だけ、世界がひらく。」が説明なしで一目で理解できる。
- [ ] Fog → Revealが300〜700msで動画上明確に見え、reduced motionでも情報が失われない。
- [ ] Unknown / Passed / Experienced / Memoryを色以外のtexture、border、node、depthでも判別できる。
- [ ] Memory nodeが390px画面と1080p収録映像で認識できる。
- [ ] Cell Detailに地域、訪問回数、Memory数、Memoryタイトルが優先表示される。
- [ ] Cell → Memory Detailが実データで動く。
- [ ] Cell → Search / Recallがvalidated、owner-scopedなcell contextを実際に使う。
- [ ] Passed ×1、Experienced ×1、Memory ×2を含む3〜6地域をlocal-only seedで再現できる。
- [ ] refresh後もMap状態が残り、同一cell再訪で重複rowが増えない。
- [ ] denied、unavailable、timeout、API error、empty、Memoryなし、network latencyで画面が破綻しない。
- [ ] 390pxでhorizontal overflowなし、Bottom Navigation非衝突、主要CTA 44px以上、親指操作可能。
- [ ] 1440pxでMapが小さなcardではなくHero Visualとして成立する。
- [ ] exact GPS / path / second-by-second positionがBackend、DB、AI、Analytics、logへ送られない。
- [ ] H3 cellを匿名情報と表現せず、位置情報のデータ最小化として説明する。
- [ ] Map表示とRevealのLLM costが0である。
- [ ] `pnpm verify`、`pnpm test:e2e`、local Supabase `db reset` / `test db`がlatest main統合後に成功する。
- [ ] GPS失敗時も保存済みMap → Memory Cell → Recallで30秒デモを完走できる。

## 推奨実装順

1. latest mainを対象branchへ取り込み、PR #30のlocation / onboarding文言とMap設定を整合させる。
2. local-only demo seedを先に作り、以後のVisual / E2Eを同じデータで評価する。
3. Hero-first layoutとReveal animationを390pxで完成させ、1440pxへ展開する。
4. Cell-scoped Recallをend-to-endで接続し、Cell → Memory / Recallの両経路を固定する。
5. GPS error分類、latency、fallbackを追加し、実撮影リハーサルを行う。
6. P0だけでDEMO READY判定を実施し、残usageとSubmission全体を見てP1を選別する。
