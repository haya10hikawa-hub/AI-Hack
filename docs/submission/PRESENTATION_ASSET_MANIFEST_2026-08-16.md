# Re:Memory Presentation / Poster Asset Manifest — 2026-08-16

This manifest records the visual artifacts generated during the final AI HACK submission work so that the design decisions are not lost even before the PNG binaries are manually added to the repository / Figma deck.

> Note: the current GitHub connector can create UTF-8 repository files but cannot upload these generated PNG binaries directly. The binary files therefore need one manual drag-and-drop / commit step. Their content and intended names are preserved here.

## Design basis

The slide / poster visual language follows the existing Re:Memory submission deck:

- white / warm-white background
- dark indigo editorial headline
- subtle translucent blue geometry
- thin lines with indigo / sage / coral nodes
- rounded white cards
- restrained blue highlight bars
- judge-facing information density: one clear claim per slide, diagrams over paragraphs

## Generated slide 1 — Memory Map / originality

Suggested repository name:

`docs/submission/assets/memory-map-life-map.png`

Generated working filename:

`記憶を再構成する人生の地図.png`

Core message:

> 記憶を“人生の地図”として再構成する

Four-state visual:

1. はじまり
2. 記憶を集める
3. つながりが広がる
4. 人生の地図に

Judge axis:

- ⑧ 次世代性・独創性

Key line:

> 単なる位置履歴ではなく、“その場所で何をしていたか”を思い出すためのマップ。

## Generated slide 2 — Business model

Suggested repository name:

`docs/submission/assets/business-pricing-480.png`

Generated working filename:

`無料で広げ_480円で成立させる.png`

Core message:

> 無料で広げ、480円で成立させる

Pricing shown:

- Free: ¥0
- Founding Plus: ¥480/month
- Family β: ¥980–1,280/month

Also shows future revenue sources:

- Personal Subscription
- Family
- Memory Book
- API
- OEM

Judge axis:

- ② ビジネス成立性

## Generated slide 3 — Unit economics / LLM cost

Suggested repository name:

`docs/submission/assets/unit-economics-free-support.png`

Generated working filename:

`plus_1人で支える無料ユーザー設計.png`

Core message:

> Plus 1人で、Free 8〜10人を支える設計

Planning model:

```text
Revenue                 ¥480
AI cost                ~¥120
Infrastructure          ~¥40
Payment                 ~¥17
Gross profit            ~¥303
Gross margin            ~63%
```

Free target variable cost:

- ¥30–40/user/month

Calculation:

```text
¥303 ÷ ¥30–40
≈ 7.6–10.1 users
```

Judge axis:

- ⑥ LLMコスト
- ② ビジネス成立性

Important label:

> 実測前の仮説値。Production telemetryで再計算する。

## Generated slide 4 — Trust / roadmap

Suggested repository name:

`docs/submission/assets/private-default-roadmap.png`

Generated in the final four-slide set.

Core message:

> Private Defaultで信頼を守りながら広げる

Security / Privacy side:

- Private Default
- foundation-model training dataとして勝手に使わない
- Familyは明示共有のみ
- user-controlled photo / location / calendar scope

Roadmap side:

- Phase 1: 0–1,000 MAU / free
- Phase 2: 1,000–5,000 MAU / Founding Plus ¥480
- Phase 3: 5,000–20,000 MAU / Family β ¥980–1,280

Key line:

> Personal AI = モデルを再学習するのではなく、Confirmed Memoryを必要なときだけRetrievalして文脈として渡す。

Judge axis:

- ⑦ Security
- ② Business

## Generated poster — MacBook 14-inch-oriented landscape

Suggested repository name:

`docs/submission/assets/rememory-mac14-poster.png`

Core headline:

> Re:Memory
>
> 思い出は、つながるほど、鮮やかになる。

Poster composition:

- left: product statement and four-step Map evolution
- center: large phone showing Memory Map
- right: Memory Thread
- bottom: three product pillars
  - Memory Map
  - Memory Thread
  - Recall
- privacy strip explaining:
  - AI inference is explicit
  - user confirmation is prioritized
  - location precision is controlled

Footer:

> AI HACK 2026 / Personal Memory AI

## Figma placement

These PNGs were intended to be pasted into the existing AI HACK Re:Memory Figma Slides deck while preserving its design baseline.

Recommended rule:

- keep the generated slide as a single image when speed is more important than editability
- recreate only text elements in Figma if typo correction / last-minute number changes are needed
- do not change the business figures without updating `BUSINESS_PLAN_2026-08-16.md`
