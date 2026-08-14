# Remote Branch Consolidation Audit — 2026-08-14

## Goal and safety boundary

This audit supports consolidating the GitHub remote to `main` without losing valid implementation, documentation, or tests. No branch is deleted until its tip, unique commits, patch relationship to `main`, integration decision, and verification status have been recorded.

History rewriting, force pushes, hosted database resets, and production seed operations are out of scope.

## Baseline

- Repository: `haya10hikawa-hub/AI-Hack`
- Audited main tip: `3c8e8d978bbb4bcd43b0a18e32f622bf3cbd8521`
- First consolidation merge tip: `052690e65938f5b8d2b38d66e6172fa654a5a466`
- Discovery: `git fetch --all --prune`, followed by enumeration of `refs/remotes/origin`
- Patch check: `git cherry origin/main origin/<branch>` and `git log --left-right --cherry-pick origin/main...origin/<branch>`
- Content check: merge-base ancestry, three-dot diff, commit inspection, and comparison with current `main`

## Branch decisions

| Remote branch                              | Recorded tip SHA                           | Classification before consolidation                                                                                       | Decision                                                                                            |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `agent/document-parallel-workflow-option`  | `24dcf8a4d8e614b96399c2c1290442e60cbdaf17` | Valid unique documentation; two commits not patch-equivalent to `main`                                                    | Preserve `WORKFLOW_OPTIONS.md` and its README link in the consolidation change                      |
| `codex/durable-analysis-jobs`              | `b41833420da4d5dfa5c20e3fc54b10f4b2c80ac4` | Tip is an ancestor of `main`; no branch-side patch remains                                                                | Delete only after verified `main` is updated                                                        |
| `codex/final-product-completion`           | `0f0a3cc52834a33ac3e4ef48929d1985c1d59b44` | Tip is an ancestor of `main`; no branch-side patch remains                                                                | Delete only after verified `main` is updated                                                        |
| `codex/handoff-roadmap`                    | `a6372c952df0e56546e9dc71225138529766802a` | Two unique documentation/comment commits, but their durable-job and GitHub Actions status is superseded by current `main` | Do not merge the stale patch; retain this recorded tip for recovery, then delete after verification |
| `codex/memory-exploration-map-mvp`         | `c4b0626d0f2706f7a57ec63c110d30c88d7f0bc1` | Valid unique implementation, migration, documentation, and tests; four non-merge commits not patch-equivalent to `main`   | Preserve all four unique commits in the consolidation change                                        |
| `codex/orcarouter-production-preflight-v2` | `86451263db2c5341ffac4ade9c36b25639e46720` | Valid production preflight, health, runbook, checklist, and contract-test changes discovered after the first merge        | Preserve the unique commit in a follow-up consolidation change                                      |
| `codex/product-completion`                 | `4da075bd036da9ce878ba9bf25335e67bc120dbe` | Tip is an ancestor of `main`; no branch-side patch remains                                                                | Delete only after verified `main` is updated                                                        |
| `codex/rememory-mvp`                       | `4ae7c9758f0727bfbe97a91a95cad5f9798c57af` | Tip is an ancestor of `main`; no branch-side patch remains                                                                | Delete only after verified `main` is updated                                                        |
| `docs/event-semantics-search-architecture` | `a332bd60dfcc330b66a18b869cdfc773c555d8af` | Tip is an ancestor of `main`; no branch-side patch remains                                                                | Delete only after verified `main` is updated                                                        |
| `docs/legal-onboarding-copy`               | `d949b4e59ce60d26d0719cfd6ab36e954dca64e3` | Tip is an ancestor of `main`; merged by PR #30                                                                            | Delete only after verified `main` is updated                                                        |
| `docs/security-review-2026-08-14`          | `1c317f630b89824116ffc8d7a29d34d96b16fdc1` | Tip is an ancestor of `main`; merged by PR #14                                                                            | Delete only after verified `main` is updated                                                        |

## Superseded branch rationale

`codex/handoff-roadmap` described upload analysis as a best-effort `after()` continuation and tracked migration away from Node.js 20-based Actions. Current `main` already contains durable analysis recovery, and CI uses `actions/checkout@v5` and `actions/setup-node@v5`. Merging the old branch would therefore reintroduce outdated operational guidance without adding a current implementation or test.

## Preserved unique commits

The consolidation branch was created from the audited `origin/main`. The following source commits were replayed without merging stale branch histories:

- Workflow proposal: `45313fda4d999b7dd8d702d69b2292e6bef86981`, `24dcf8a4d8e614b96399c2c1290442e60cbdaf17`
- Memory Exploration Map: `def2b3443f627a1dbe9983c4950001cf8e797268`, `03f2fa4d1009bb9df5a555c18d92d415744be383`, `13213e760440c02e528cb4e6c049d028ffe2a617`, `c4b0626d0f2706f7a57ec63c110d30c88d7f0bc1`
- OrcaRouter production preflight: `86451263db2c5341ffac4ade9c36b25639e46720`

The Memory Map branch's merge-from-main commit was intentionally not replayed; its resulting content is already represented by the latest-main baseline plus the four branch-side commits above.

## Required closeout evidence

Before remote branch deletion, record:

1. full local verification results;
2. successful GitHub pull-request CI;
3. the resulting `main` tip;
4. content and patch checks proving the three preserved change sets exist on updated `main`;
5. the final remote branch list.
