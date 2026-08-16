# Re:Memory Business Plan — 2026-08-16

> Planning model for AI HACK 2026 judging. Figures below are assumptions for validation, not measured production economics.

## Initial pricing

### Free — ¥0

Assumption:

- about 20–30 photos/month
- basic Memory generation
- basic Recall
- Memory Thread
- low-friction product trial

### Founding Plus — ¥480/month

Assumption:

- about 100 photos/month
- Personal AI context
- richer Recall
- more Memory processing
- Memory Map
- strong-model escalation only when needed

Why not ¥980 from the start:

At the stage where users may still perceive Re:Memory as “a photo app,” ¥980 creates a relatively high psychological barrier. The initial hypothesis is therefore to validate willingness to pay below ¥500, then revise pricing from retention, paid conversion, and real AI cost data.

### Family β — ¥980–1,280/month

Direction:

- shared Family Memory
- family-wide Recall only over Memories explicitly shared by users
- Private Default
- no automatic pooling of every private Memory

## Founding Plus unit-economics target

Planning assumption per active Plus user per month:

```text
Revenue                 ¥480
AI variable cost       ~¥120
Infrastructure          ~¥40
Payment fee             ~¥17
--------------------------------
Gross profit            ~¥303
Gross margin            ~63%
```

This is a target model, not a production measurement.

## How many Free users can one Plus user support?

If Free variable cost is controlled to approximately ¥30–40/user/month:

```text
¥303 ÷ ¥30–40
≈ 7.6–10.1 users
```

Target structure:

> One Founding Plus user can cover the variable cost of roughly 8–10 Free users.

This is useful for the initial free-growth strategy because monetization does not have to start on day one.

## Cost-control principles

Do not reduce quality only by choosing the cheapest model. First reduce unnecessary AI calls.

```text
Deterministic work
→ normal code

Light ambiguous work
→ low-cost model

Difficult / high-value reasoning
→ strong model escalation
```

Current product-side cost controls include / target:

- group photos into events / sequences
- Vision only on representative images rather than every image
- maximum representative-image budget per event
- checkpoint / retry so Vision is not repeated unnecessarily
- role-based model routing
- request and user cost limits
- rate limits
- Memory Gap confirmation only when context is missing

## Key metrics after launch

Do not optimize only for MAU. Track whether Memory actually becomes valuable over time.

Primary metrics:

- Activation
- Memory Creation
- D7 Retention
- D30 Retention
- Recall usage rate
- Free → Plus conversion
- Paid churn
- AI Cost / User
- Cost / Confirmed Memory
- Plus retention

## Business roadmap

### Phase 1 — 0–1,000 MAU

Price: completely free.

Goal: validate whether users continue to use the product and whether accumulated Memory creates value.

Focus metrics:

- Activation
- Memory Creation
- D7 / D30 retention
- Recall usage

### Phase 2 — 1,000–5,000 MAU

Launch Founding Plus at ¥480/month.

Focus metrics:

- Paid conversion
- Churn
- AI Cost / User
- Cost / Confirmed Memory
- Plus retention

### Phase 3 — 5,000–20,000 MAU

Launch Family β at approximately ¥980–1,280/month.

Focus metrics:

- Family sharing rate
- family Recall success
- retention
- privacy / trust feedback

### Later expansion

Potential revenue sources beyond subscription:

- Personal Subscription
- Family
- annual Memory Book / archive product
- additional storage
- Memory Engine API
- OEM integration with camera / photo / device ecosystems

The intended model is not ad-centric. A service asking users to entrust personal memories should avoid creating a business incentive to exploit those memories for ad targeting.

## Personal AI value proposition

Paid value should not be “we use a more expensive LLM.”

The stronger long-term value is that Re:Memory can retrieve previously confirmed context when needed:

```text
New media
+ Confirmed Memory
+ User corrections
+ recurring places / activities
→ Personal Context
→ better grounded inference / Recall
```

This means retrieval over user-approved context, not automatically training a foundation model on private family data.
