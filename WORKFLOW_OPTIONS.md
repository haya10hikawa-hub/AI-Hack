# 並行開発ワークフロー案

> **Status: Proposal / 作業方法の候補**
>
> この文書は確定ルールではありません。Re:Memory MVPを3台のCodexと1台のClaudeで並行開発する場合の候補です。実際の担当・ブランチ名・統合順は、開発開始時にチームで確認してください。

## 目的

複数のAIコーディングエージェントを使い、GitHubを合流地点としてMVP開発を短縮します。

4台が同じファイルを同時に変更するのではなく、機能境界ごとにブランチを分けます。共通基盤と契約を先に固定し、各担当は小さなPull Requestを作成します。

## 推奨体制

| 担当    | 主な責務                                                                     | ブランチ例                |
| ------- | ---------------------------------------------------------------------------- | ------------------------- |
| Codex 1 | 統合リーダー、初期構築、共通型、Supabase接続、PRレビュー、最終統合           | `codex/foundation`        |
| Codex 2 | DB migration、RLS、Storage、Upload、EXIF、Temporal Sequence                  | `codex/backend-ingestion` |
| Codex 3 | Memory Thread、Memory Detail、Confirmation、Search UI、Responsive UI         | `codex/frontend-ui`       |
| Claude  | AI Adapter、Memory Gap、Retrieval、Grounded Answer、テスト・Securityレビュー | `claude/ai-review`        |

ClaudeをAI領域ではなくQA専任にする案もあります。実装速度を優先する場合はAI Adapterを担当し、安全性を優先する場合は横断レビューを担当します。

## 開発開始前に固定するもの

並行作業を始める前に、Codex 1が以下を定義して`main`へ先行マージします。

- Next.jsのディレクトリ構成
- Supabase migrationの命名・適用順
- 主要EntityのTypeScript型
- APIの入力・出力Schema
- `AIProvider` interface
- Claim / Evidence / UserCorrectionの状態遷移
- 環境変数名と`.env.example`
- Design Tokenと共通UI primitive
- lint / typecheck / testコマンド

このFoundation PRがマージされるまでは、他担当は仕様確認・実装計画・テストケース作成までに留めます。

## 推奨フロー

1. Codex 1がFoundation PRを作成する
2. Foundationをレビューして`main`へマージする
3. 各担当が最新`main`から担当ブランチを作る
4. 各担当は1つの目的に絞った小さなPRを作る
5. Codex 1が共通契約・DB invariant・競合を確認する
6. CI通過後に依存順でマージする
7. Hero FlowのE2Eテストを行う
8. Claudeまたは空いたCodexがSecurity / Privacy / Costを横断レビューする

## 推奨マージ順

```text
Foundation
→ Database / Auth / RLS / Storage
→ Media Ingestion / EXIF / Temporal Sequence
→ AI Adapter / Evidence / Claim
→ Memory Engine / Memory Gap / Confirmation
→ Retrieval / Grounded Answer
→ Memory Thread / Detail / Search UI
→ Integration / E2E
→ Security / Privacy / Cost Review
```

FrontendはMock Serviceを使って先行開発できます。ただし最終マージ前に、実API Schemaと一致していることを確認します。Hero Flowをhard-codeされたAI回答だけで成立させません。

## 競合を避けるための所有範囲

原則として、以下は統合担当だけが変更します。

- `package.json`とlock file
- 共通Entity型
- Supabase migration番号
- `.env.example`
- Root layoutと共通Provider
- CI設定
- 共通Design Token

依存追加や共通契約の変更が必要な場合は、担当PRで無断変更せず、先にIssueまたはFoundation変更PRを作ります。

## Pull Requestルール案

- 1 PR = 1つの目的
- Draft PRを早めに作る
- PR本文に変更範囲、依存PR、検証結果、未完了点を書く
- DB変更にはmigrationとRLS testを含める
- API変更にはZod Schemaと呼び出し側の更新を含める
- UI変更にはLoading / Empty / Error stateを含める
- AI変更にはinvalid output、timeout、cost capの扱いを書く
- 他担当の所有ファイルを変更する場合は理由を明記する
- `main`へ直接pushしない

## 完了条件

各担当の実装完了ではなく、次のHero Flowが実データで成立した時点をMVP統合完了とします。

```text
Upload
→ Metadata / EXIF
→ Temporal Sequence
→ AI Analysis
→ Evidence / Claim / Memory
→ Memory Gap
→ User Confirmation
→ Natural Language Search
→ Grounded Answer
```

最低限の検証:

- lint
- typecheck
- unit tests
- fresh database migration
- RLS / cross-user isolation test
- private Storage test
- AI invalid Schema test
- uploadからGrounded AnswerまでのE2E
- smartphone viewport確認

## 想定時間

並行化しても、4台だから単純に4分の1にはなりません。Foundation、レビュー、外部サービス設定、競合解消、統合テストが直列工程として残ります。

| 完成レベル                   | 単独作業の目安 | 4台並行の目安 |
| ---------------------------- | -------------: | ------------: |
| ハッカソン提出可能MVP        |     18〜30時間 |    10〜18時間 |
| 仕様を広く満たす実用MVP      |     40〜65時間 |    24〜40時間 |
| Security・テスト・仕上げ込み |    65〜100時間 |    38〜65時間 |

この時間は、Supabase、AI Gateway、Vercelのアカウントと環境変数が利用可能で、Product Open Questionsによる長時間の停止がない場合の概算です。

## 選択肢

### Option A: 統合重視（推奨）

Codex 1を統合責任者に置き、残り3台が機能実装を担当します。実装人数は実質3台ですが、常に動く`main`を維持しやすい方式です。

### Option B: 速度重視

4台すべてが実装し、時間帯ごとに1台が統合を担当します。初速は速い一方、共通ファイルの競合と仕様ずれが増えやすくなります。

### Option C: 品質重視

3台のCodexがFoundation / Backend / Frontendを担当し、Claudeはコードを変更せず、AI safety、RLS、Privacy、テスト不足をレビューします。完成まで少し長くなりますが、個人写真を扱うRe:Memoryには適しています。

## 未決定事項

開発開始前に以下を決めます。

- ClaudeをAI実装担当にするかQA専任にするか
- Calendar connectorをMVPへ含めるか
- ConfirmをBottom Navigationへ置くかHomeへ統合するか
- Delete / Forget UIをどこまで見せるか
- coarse locationの変換方法
- 各PRを誰が最終承認するか
