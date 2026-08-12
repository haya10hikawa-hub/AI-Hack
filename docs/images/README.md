# Re:Memory Image & Design Assets

このディレクトリは、開発者がUI・ブランド・アーキテクチャを実装するときに参照するビジュアル資料置き場です。

## Source of truth

- 機能・プロダクト仕様: `/IMPLEMENTATION_PROMPT.md`
- Database / RLS / Storage: `/DATABASE_DESIGN.md`
- Architecture reference: `architecture/`
- UI / Design reference: `ui/`

画像は**視覚参照**です。画像内にある機能を、仕様書に存在しないという理由だけで勝手に追加しないでください。逆に、画像に描かれていなくても `IMPLEMENTATION_PROMPT.md` のMUST要件は実装対象です。

## Re:Memory Visual Grammar

- `●` = Evidence / User Confirmed
- `○` = AI Inference
- `━━` = Confirmed Relation
- `┈┈` = AI Inferred Relation
- Memory = Surface / Card
- Evidence = Node
- Relation = Line
- Time = Vertical Axis

Memory ThreadはスマートフォンではCompactを基本とし、選択したMemoryだけRelationを展開します。

## UI design history

UI資料は以下の順で検討されました。

1. `ui-ver01` — 初期UI/UX構成
2. `ui-ver02` — Smartphone-first UX
3. `ui-ver03` — Memory Thread / Evidenceを強化
4. `ui-ver04` — Brand / Node Colon / Visual Grammarを整理
5. `ui-final` — 現時点の最終UI仕様

実装時は **ui-finalを第一参照** とし、過去版は設計意図・比較用として利用してください。

## Important

AI推定とユーザー確認を視覚的にもデータ上も混同しないこと。Confidenceは根拠のない百分率として見せず、Evidence strengthと理由を表示すること。Confirmationは通常操作を妨げない非同期型を基本とします。
