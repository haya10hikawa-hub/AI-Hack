# Re:Memory — AI HACK 2026 Final Submission Worklog

Updated: 2026-08-16

This document preserves the final product, business, UI, Map, presentation, and publication decisions that were developed during the final submission phase.

## Current implementation / PR state

- Memory Core baseline: merged via PR #106
- Memory-first UI / Evidence secondary: merged via PR #104
- Recall-ready Memory retrieval backend: merged via PR #105
- Qiita award-pattern restructure: merged via PR #100
- iOS native client: merged via PR #107
- Place Picker: PR #103 remains open and must not be described as merged `main`
- Native monthly-event / Memory Map visual fidelity work: preserved as Draft PR #110
- `pr111` iOS-first consolidation / AI pipeline work: preserved as Draft PR #111 because it contains destructive Web-client removals and must not be merged as-is
- PR #109 remains open on `pr108`

## Product thesis

> Photosは写真を探す。Re:Memoryは出来事を覚える。

Re:Memory is a Personal Memory AI that reconstructs events from evidence instead of asking an LLM to freely write memories.

Core flow:

```text
Media
→ Metadata
→ Temporal Sequence
→ Event
→ Evidence
→ AI Inference / Claim
→ Memory Gap
→ User Confirmation
→ Memory
→ Search / Recall / Map
```

## Truth model

Re:Memory keeps AI inference separate from confirmed information.

```text
○ AI Inference
┈┈ AI-inferred relation

● Evidence / User Confirmed
━━ Confirmed relation
```

The goal is not to hide uncertainty. The UX should visibly turn uncertain context into confirmed Memory when the user verifies it.

## UI direction

The target is not an AI dashboard or a generic card-based SaaS UI.

Design direction:

> Memory Editorial / Living Personal Archive

Priorities:

1. Memory is the hero.
2. Photography communicates emotion.
3. Node state communicates certainty.
4. Lines communicate relationships.
5. AI stays secondary until needed.
6. Evidence / provenance remains inspectable but is not the default visual focus.

## Memory Map direction

Map is not activity tracking.

Concept:

> 生きた場所だけ、世界がひらく。

The Map should act as a spatial entry point into Memory:

```text
はじまり
→ 記憶を集める
→ つながりが広がる
→ 人生の地図に
```

The experience should answer “その場所で何をしていたか” rather than continuously expose exact movement history.

## Privacy direction

- Private by default
- Original media remains in private storage
- AI receives only the minimum information needed
- Exact historical GPS should not be exposed as the normal Memory representation
- Location can be reduced to coarse spatial cells / trusted place context where appropriate
- AI inference and user-confirmed facts remain distinguishable
- Family context must be opt-in, not automatic aggregation of every family member's private Memory

## Final monetization direction

Initial strategy:

- Free: ¥0
- Founding Plus: ¥480/month
- Family β: ¥980–1,280/month

The first phase prioritizes retention and Memory accumulation before monetization.

The current unit-economics figures are planning assumptions, not production measurements. See `BUSINESS_PLAN_2026-08-16.md`.

## Submission media direction

The final visual language used for slides/poster is:

- white / warm-white background
- deep indigo typography
- light translucent blue geometric shapes
- small coral / sage / indigo nodes connected by thin lines
- editorial serif headline treatment
- rounded white information panels with subtle borders
- diagrams over dense paragraphs

The generated PNG assets are tracked in `PRESENTATION_ASSET_MANIFEST_2026-08-16.md`.

## Publication / Truth Audit

Before public submission, every claim must be classified as one of:

- Implemented
- Validated
- Roadmap / planned

Do not claim production cost, provider latency, E2EE, Zero-Knowledge, or Place Picker merge status unless actually verified on the final `main` / production environment.
