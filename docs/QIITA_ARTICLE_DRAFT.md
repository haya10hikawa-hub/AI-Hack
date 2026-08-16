# LLMに「記憶」を作らせない。EvidenceとHuman-in-the-LoopでつくるPersonal Memory AI「Re:Memory」

> AI HACK 2026 提出記事ドラフト
>
> **公開前TODO:** `[TODO]` をすべて解消し、Issue #99 のTruth Auditを通すこと。

## はじめに — 写真は残る。でも「なぜそこにいたか」は消えていく

スマートフォンには大量の写真が残っています。

数年前の写真を見返したとき、撮った場所や写っている物は分かっても、

- 何の日だったのか
- なぜそこにいたのか
- 何をしていたのか
- その出来事の前後に何があったのか

といった**写真を記憶にしていた文脈**だけが抜け落ちていることがあります。

そこで開発したのが、Personal Memory AI **Re:Memory** です。

> **Photosは写真を探す。Re:Memoryは出来事を覚える。**

Re:Memoryは、写真を自然言語で検索できるようにするだけのアプリではありません。
写真・撮影日時・粗い場所・ユーザー本人の回答などをEvidence（証拠）として扱い、AIが出来事の候補を整理し、分からない部分だけをユーザーに確認します。

AIが一方的に「思い出」を生成するのではなく、**AIと人間が一緒にMemoryを形成する**ことを目指しています。

<!-- TODO #22/#90: ここに3分デモ動画を配置。記事を開いて30秒以内に動くプロダクトを見せる。 -->

**デモ動画:** [TODO: URL]

---

## まず体験 — ○だった推定が、本人の確認で●になる

Re:Memoryの中心体験は、AIチャットそのものではありません。

AIが写真などから推定した情報と、ユーザー本人が確認した情報を明確に分けます。

```text
○  AI Inference
┈┈ AIが推定した関係

●  User Confirmed / Evidence
━━ 本人確認済みの関係
```

例えば、写真から「ロボット活動らしい」と推定できても、それだけでは「FTCの練習だった」と事実認定しません。

```text
写真・Metadata
    ↓
○「ロボット活動？」
    ↓
AI: 「この日はFTCの練習だった？」
    ↓
ユーザー: 「そう」
    ↓
●「FTCの練習」
```

この **○ → ●、点線 → 実線** の変化を、Re:Memoryでは「記憶がつながった瞬間」として扱います。

<!-- TODO #65/#66/#98: confirmation transitionのGIFまたは連続スクリーンショットを挿入。 -->

---

## なぜ「写真 → LLM → 思い出」にしなかったのか

画像認識モデルに写真を渡し、そのまま「この日の思い出を書いて」と依頼すれば、非常に自然な文章は生成できます。

しかし、Personal Memoryでは**自然さよりも根拠が重要**です。

画像から見えるのは、物体・場所らしさ・行動の一部などです。一方で、

- なぜそこにいたか
- 誰との関係で参加したか
- 本人にとって何が重要だったか

までは、画像だけでは確定できません。

もっともらしい補完をMemoryとして保存してしまうと、AIが生成した情報と本人の記憶が混ざります。

そこでRe:Memoryでは、生成文章を直接Memoryにせず、以下の層を分離しました。

```text
Media
  ↓
Metadata / Temporal Sequence
  ↓
Event
  ↓
Evidence
  ↓
AI Inference / Claim
  ↓
Memory Gap Detection
  ↓
User Confirmation
  ↓
Memory
```

### Evidence First

AIが出した事実候補はClaimとして扱い、その根拠となるEvidenceを追跡します。

### Uncertainty is a Feature

根拠が足りなければ、無理に確定せず「未確認」に残します。

### Human Correction

ユーザー本人の確認・訂正はAI推定より強い情報として扱います。

Re:Memoryで解きたいのは「AIに思い出を作文させる」問題ではなく、**不確実な情報から、どこまでをMemoryとして信頼してよいかを管理する問題**です。

---

## Memory Gap — 「分からない」を失敗ではなく機能にする

Re:Memoryでは、Context Completenessを見て不足している文脈をMemory Gapとして扱います。

例えば、

```text
日時     → Evidenceあり
場所     → Evidenceあり
活動     → AI推定あり
目的     → Evidence不足
```

なら、目的を勝手に生成するのではなく、ユーザーへの確認候補に落とします。

```text
AIが不足文脈を検出
    ↓
「この日は何のために行った？」
    ↓
ユーザーが確認 / 訂正 / あとで
    ↓
User Confirmed Claimとして保存
```

つまりRe:Memoryでは、AIの役割を

> **答えを全部作ること**

ではなく、

> **分かっていることと分からないことを切り分け、必要なときだけ人間に聞くこと**

に置いています。

---

## System Architecture — LLMの柔軟性と、確定処理を分離する

システム全体はNext.js / Supabase / PostgreSQL / Private Storage / server-only AI adapterを中心に構成しています。

```text
Browser
  │
  │ verified session
  ▼
Next.js Route Handlers
  │
  ├─ deterministic ingestion
  ├─ owner-scoped trusted writes
  ├─ Search / Recall orchestration
  └─ AI adapter
        │
        ▼
OrcaRouter-compatible OpenAI endpoint

Supabase
  ├─ Auth
  ├─ PostgreSQL + RLS
  └─ Private Storage
```

重要なのは、**LLMに任せる責務と任せない責務を分けること**です。

### deterministicに処理するもの

- Auth / owner判定
- 時系列ソート
- Temporal Sequenceの基本処理
- IDの存在確認
- active / deleted状態
- 前後Memoryの取得
- rate / cost gate
- Storage / DB mutation

### AIを使うもの

- 画像からの観察候補
- Event / Claim候補の構造化
- 不足文脈の候補
- 曖昧な自然言語Queryの解釈
- 必要な場合のcandidate rerank

AIが返したIDや事実候補を、そのまま権限やDB更新の根拠にはしません。

---

## AIは落ちる前提 — Durable Analysis Job

AI APIをプロダクトで使うと、正常系だけでは足りません。

- timeout
- 5xx
- rate limit
- process終了
- retryによる二重生成

が起きます。

Re:Memoryでは解析を単なるHTTPリクエストの続きとして扱わず、PostgreSQLに永続Jobを持たせています。

```text
queued
  ↓
analysis / Vision
  ↓
checkpoint: claims
  ↓
Claim generation
  ↓
checkpoint: gap
  ↓
Memory Gap
  ↓
complete / failed
```

lease、heartbeat、bounded retry、checkpointを持たせ、途中停止後も再開できるようにしました。

特に、Visionが成功したあとClaim生成で失敗した場合に、retryで高コストなVisionを最初から繰り返さないことを重視しています。

また、retry時にEvidence / Claim / Gapが重複しないよう、安定したdedupe境界を持たせています。

<!-- TODO #47/#48: 実Providerでprocess-stopを行った最終acceptance結果を追記。未検証なら「コード実装済み・実Provider検証待ち」と明記。 -->

---

## SearchではなくRecallへ — 自分のMemoryを会話で辿る

Re:Memoryの検索では、単にEmbedding距離が近い1件を返すことを目的にしていません。

```text
Natural Language Query
    ↓
Structured interpretation
    ↓
Owner-scoped candidate retrieval
    ↓
Grounding / rerank
    ↓
clear / ambiguous / unknown
    ↓
Evidence-backed answer
```

候補が拮抗していれば複数候補を提示し、Evidenceが足りなければ「分からない」を返します。

Recallではさらに、会話全文を無制限にLLMへ渡すのではなく、選択中Memoryや時間軸などのstructured stateを使って、

- 「その前は？」
- 「その後は？」
- 「他には？」
- 「違う」
- 「どこ？」

といった操作をMemory探索につなげる設計を進めています。

<!-- TODO #72-#79: 実装済み範囲を最終mainで確認し、未実装のfollow-upはRoadmap表現へ変更。 -->

---

## Memory Map — 正確なGPSを保存せず、場所を「記憶への入口」にする

時間はMemory Thread、言葉はRecall。そして場所からMemoryを辿るためにMemory Mapを実装しました。

コンセプトは、

> **生きた場所だけ、世界がひらく。**

です。

ただし、行動追跡サービスにはしたくありませんでした。

現在地を使う場合も、正確な緯度・経度を通常のDB状態として保持するのではなく、ブラウザ内で粗いH3 Cellへ変換してから扱います。

```text
Exact GPS
   ↓ browser内で変換
Coarse H3 Cell
   ↓
Exact GPSを通常状態へ残さない
   ↓
Cell × Memory
```

Mapの目的は「どこにいたかを監視する」ことではなく、**場所を入口として、自分のMemoryを思い出すこと**です。

---

## AI基盤とOrcaRouter

本開発ではAI HACK 2026のリソース提供として **[OrcaRouter](https://www.orcarouter.ai/ja)** を利用しています。

Re:Memory側はAI Providerをブラウザから直接呼ばず、server-onlyのAI adapterを通してOpenAI互換endpointへ接続する構成にしています。

```text
Browser
  ↓
Re:Memory Server
  ↓
typed AI adapter
  ↓
OrcaRouter-compatible endpoint
  ↓
AI model
```

OrcaRouter公式では、OpenAI互換の単一endpoint、複数モデル、ルーティング、フェイルオーバー、request単位のmodel / latency / cost可視化などが提供されています。

Re:Memoryでは、これらOrcaRouter側の提供機能と、Re:Memory自身が実装しているmodel selection / cost gate / retry境界を混同しないように説明します。

**公開時には、実際に利用・検証したOrcaRouter機能だけをRe:Memoryの実績として記載します。**

<!-- TODO #42/#80/#81: 実Provider/model、request cost、latencyを実測後に追記。 -->

---

## LLMコスト — 「どのモデルを使うか」の前に「呼ぶ必要があるか」を考える

LLMコストを抑えるために、すべてを安いモデルへ置き換えるだけではなく、**AIを呼ばなくてよい処理では呼ばない**ことを優先しています。

```text
確定できる処理
  → deterministic

曖昧だが軽い処理
  → cheap model

品質差が重要な処理
  → strong model / escalation
```

さらに、

- representative image数の上限
- request timeout
- bounded retry
- per-user rate limit
- per-request / daily cost gate
- checkpoint recoveryによるVision再実行回避

を組み合わせています。

### 実測コスト

<!-- TODO #80/#81: OrcaRouter実測値で置換。推測値を掲載しない。 -->

| 処理 | Model | 平均Latency | 平均Cost |
|---|---|---:|---:|
| Vision / Sequence | [TODO] | [TODO] | [TODO] |
| Claim生成 | [TODO] | [TODO] | [TODO] |
| Memory Gap | [TODO] | [TODO] | [TODO] |
| Recall 1 turn | [TODO] | [TODO] | [TODO] |
| 10 photos Hero Flow | — | [TODO] | [TODO] |

この表は提出直前の実Provider計測結果だけで埋めます。

---

## Security / Privacy — Personal MemoryだからAIより先に境界を作る

Re:Memoryは写真・位置情報・本人の過去を扱うため、Security / Privacyを後付けにはできません。

主な境界は次の通りです。

```text
Authentication
    ↓
Same-Origin mutation
    ↓
Input validation
    ↓
Authorization / RLS
    ↓
Private Storage
    ↓
Owner-scoped trusted writes
    ↓
AI output schema / provenance validation
    ↓
Rate / Cost limit
```

### 写真

OriginalはPrivate Storageに置き、AI向けには必要に応じてresize・metadata除去したderivativeを使います。

### 位置情報

正確な位置をMemory Mapの通常DB状態として保持せず、coarse cellへ最小化します。

### AI

AI出力はschema validationを通し、AIが発明したIDや他ユーザーのIDをtrusted mutationへ使わない設計にしています。

### Service Role

Service roleはRLSをbypassできるため、privileged pathではsession由来のuser_idによるowner scopeを別途必要条件にしています。

<!-- TODO #46/#79/#82-#85: 最終Security suite結果を確認。 -->

---

## どこまで完成しているか — Implemented / Validated / Roadmapを分ける

ハッカソン記事で一番避けたいのは、将来構想を現在の実装のように見せることです。

公開直前のmainを基準に、機能を次の3段階へ分類します。

| 項目 | Status | 備考 |
|---|---|---|
| Auth / Private Upload | Implemented | 最終mainで確認 |
| Event / Evidence / Claim / Memory | Implemented | provenanceを保持 |
| Memory Gap / Confirmation | Implemented | user-confirmedを優先 |
| Durable AI Job | Implemented | 実Provider forced-stopは最終検証対象 |
| Search | Implemented | grounded / ambiguous / unknown |
| Recall follow-up | [TODO] | #72-#79完了状況で確定 |
| Memory Map | Implemented | coarse-cell privacy contract |
| Hosted Production Hero Flow | [TODO] | #39-#51の結果で確定 |
| Calendar Evidence | Roadmap | MVPでは未接続 |
| camera-roll background sync | Roadmap | 未実装 |
| E2EE / Zero-Knowledge | Roadmap | 現行システムの説明と混同しない |
| Memory Opportunity | Roadmap | Map Phase 2 |

<!-- TODO #99: 全主張をコード・テスト・Production証拠に照合。 -->

---

## 開発して一番難しかったこと — モデル性能ではなく「信用の境界」

Re:Memoryを作る中で中心になった問いは、

> **AIは、ユーザーの過去について何を言ってよいのか？**

でした。

モデルの出力を自然にするだけなら、プロンプトを工夫すれば改善できます。
しかしPersonal Memoryでは、自然な誤りの方が危険です。

そのため、

```text
Evidence
Inference
Unknown
User Confirmed
```

をデータとUIの両方で分離しました。

また、AIを一度呼べれば終わりではなく、timeout、retry、重複、cost、privacy、owner isolationまで含めて初めてプロダクトとして扱えることも大きな学びでした。

Re:Memoryで作っているのは「AIが全部覚えてくれる世界」というより、

> **不確実なAIと、人間の確かな確認をどう組み合わせれば、自分のMemoryを安心して残せるか**

という仕組みです。

---

## 今後

MVP以降は、現在のEvidence-first設計を壊さないことを条件に、

- Calendarを明示的なconsentのもとEvidenceとして接続する
- camera-rollからの取り込み摩擦を減らす
- Recallをより自然なMemory探索へ拡張する
- Memory MapのOpportunity表現を検討する
- Client-side Encryption / Zero-Knowledgeの適用可能範囲を研究する

などを考えています。

ただし、**将来機能を増やすことより、今あるMemory形成の信頼性を深くすること**を優先します。

---

## まとめ

Re:Memoryは、AIに人間の代わりにMemoryを書かせるサービスではありません。

AIには、

- Evidenceを整理する
- 文脈を推定する
- 足りない情報を見つける
- 後からMemoryを辿る手助けをする

ところまで任せます。

しかし最後に、

> **「これは自分の記憶として残してよいか」**

を決めるのは人間です。

```text
Evidence
+
AI Inference
+
Human Confirmation
=
Memory
```

写真は残る。
その背景の文脈も、AIと人間で一緒に残せるようにする。

それが **Re:Memory** です。

---

## リンク / リソース提供

- GitHub: [TODO: 公開可能なrepository URL / 提出時の扱いを確認]
- Demo: [TODO]
- AI Gateway / リソース提供: **[OrcaRouter](https://www.orcarouter.ai/ja)**

本開発ではAI HACK 2026のリソース提供としてOrcaRouterを利用しています。ありがとうございます。

---

# 公開前編集チェック（Qiitaには出さない）

1. 冒頭30秒以内にDemo動画を置く（#22 / #90）
2. ○→● / dotted→solidのSignature UX画像を置く（#65 / #66 / #98）
3. 現在mainのArchitecture図へ同期（#93）
4. OrcaRouterの実model / cost / latencyを実測値だけで掲載（#42 / #80 / #81）
5. Production Hero Flow実測値を掲載（#43-#51）
6. RecallのImplemented範囲をmainで再確認（#72-#79）
7. Security / cross-user isolationの最終結果を確認（#46 / #79 / #82-#85）
8. 競合比較は誇張せず、必要なら別節または提出資料へ（#96）
9. 全文をImplemented / Validated / RoadmapでTruth Audit（#99）
10. 最後にIssue #95の8審査項目coverageと照合する
