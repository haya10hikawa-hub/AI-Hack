# Re:Memory UI / Memory Map Direction — 2026-08-16

## What the UI was trying to become

Early concepts leaned heavily toward a photo-first experience:

- stacked photo cards by time
- layered Memory views
- photo-detail grids
- contextual confirmation over imagery
- Recall as an immersive photo-focus mode

The visual quality was strong, but the product risk was that Re:Memory could be understood as “another photo app.”

The design direction therefore moved from showing photos to showing the structure of Memory.

## Memory Thread

The central UI concept became the Memory Thread.

```text
Time
│
● Memory
│
├── Evidence
├── Place
└┈ AI Inference
│
● Memory
│
○ Unconfirmed context
│
● Memory
```

The visual grammar is deliberately semantic:

```text
● Evidence / User Confirmed
○ AI Inference

━━ Confirmed relation
┈┈ AI-inferred relation
```

The product should let users understand whether something is known, inferred, or confirmed without opening a technical AI panel.

## Memory-first information hierarchy

The target hierarchy is:

```text
Photography
→ Time
→ Place
→ Narrative
→ Connected Moments
→ AI
→ Evidence / Provenance
```

The order matters. AI and Evidence are available, but they are not the emotional hero of the screen.

## Implementation outcome

The implementation direction preserved these key principles even where the final MVP simplified the original concept artwork:

- Memory Thread remains the primary home metaphor
- Memory Detail moves AI / Evidence behind the Memory experience
- representative photos are used as a Memory Scene
- Connected Moments provide local context
- confirmation keeps “そう / 違う / あとで” as the lightweight Human-in-the-Loop interaction
- provenance remains inspectable
- loading / partial / failed / unknown states are treated as product states, not exceptions to hide

The goal is not pixel-perfect reproduction of concept art. The goal is to preserve the product semantics behind the art.

## Memory Map

### Product definition

Memory Map is a Recall surface, not an activity-tracking surface.

Hero concept:

> 生きた場所だけ、世界がひらく。

The experience should visually progress as Memories accumulate:

```text
1. はじまり
   まだ何も見つかっていない、真っ白な地図

2. 記憶を集める
   訪れた場所が少しずつ現れる

3. つながりが広がる
   場所とMemoryの関係が見える

4. 人生の地図に
   生きた場所がMemoryへの入口になる
```

### Interaction principle

Tap a place to recall what happened there.

```text
Place
→ Memories in that area
→ Event
→ Photos
→ Confirmed context
→ Related Memory
```

Do not optimize Map for “where were you every minute?”

Optimize it for:

> “What happened here?”

## Privacy boundary

The Map must not require exposing exact historical GPS as the normal client representation.

Direction:

```text
Exact coordinate / provider result
→ trusted server / browser reduction
→ coarse spatial cell / canonical place
→ Memory Map
```

The spatial representation should be only as precise as needed to recall Memory.

## Place Picker direction

The intended location entry UX is closer to Instagram-style place selection than raw free text:

- user types a place name
- server returns candidate places
- disambiguate by area / category
- user explicitly chooses one
- server revalidates candidate ID
- persist canonical / coarse place information rather than trusting client-provided coordinates

The Place Picker implementation exists in PR #103 but is not currently merged to `main`. Submission material must describe it as implementation-in-progress unless it is merged and validated before publication.

## Visual language

The final design system direction uses:

- deep indigo as the primary brand color
- sage for confirmed / safe states
- coral for attention / confirmation-needed states
- warm white / sand surfaces
- editorial serif titles
- restrained rounded cards
- thin connected lines and nodes
- photographic content as emotional focus

Avoid generic AI-dashboard patterns such as permanent confidence meters, large “Analyze” buttons, or AI panels dominating every screen.

## Signature microinteraction

The most important motion / state change is:

```text
○ ┈┈ ○
AI inference

   ↓ User confirms

● ━━ ●
confirmed Memory relation
```

The product value is communicated by the Memory becoming more certain—not by an AI animation for its own sake.
