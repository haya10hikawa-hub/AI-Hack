# Re:Memory Development Handoff

最終更新: 2026-08-14

この文書は、次の開発担当が「何が動き、何が未検証で、どこから再開するか」を短時間で判断するための入口です。

## 現在の到達点

AI HACK 2026 MVP の主要コードパスは実装済みです。

- Auth: sign-up / login / logout / email confirmation
- Ingestion: file validation / hash dedupe / EXIF / coarse location / derivative
- Memory graph: Asset → Sequence → Event → Evidence → Memory → Claim
- AI: privacy-safe input / structured output / validation / audit / cost and rate gates
- Human confirmation: Memory Gap / confirm / correct / 24-hour defer
- Retrieval: query parsing / candidate scoring / reranking / grounded answer
- Product UI: Home / Add / Search / Confirm / Memory detail / Privacy & AI
- Deletion: Storage cleanup followed by database finalization

`pnpm verify`、静的schema検査、Playwright mobile/desktopは成功済みです。ただしPlaywrightはSupabase / Storage / AIをfixtureで置き換えるため、実サービスの完走証明ではありません。

## 最初に着手するIssue

1. [#3 実サービス接続でHero Flowを完走・計測する](https://github.com/haya10hikawa-hub/AI-Hack/issues/3)
2. [#4 AI解析をdurable job化する](https://github.com/haya10hikawa-hub/AI-Hack/issues/4)
3. [#5 GPS粗位置を確認可能な地名へ変換する](https://github.com/haya10hikawa-hub/AI-Hack/issues/5)
4. [#6 本番デプロイ・監視・復旧手順](https://github.com/haya10hikawa-hub/AI-Hack/issues/6)

まず #3 の実環境計測を行い、その結果を使って #4 のjob設計と優先度を確定してください。

## 既知の境界と注意点

### Upload / AI processing

`POST /api/upload`はdeterministicなEvent/Memoryを保存してから応答し、Next.js `after()`でAI解析を継続します。

- `after()`はdurable queueではなく、Routeの`maxDuration=60`内です。
- upload用AI timeoutは8秒、retryは0回です。
- 最大2 Sequenceを並行処理します。
- Sequence leaseにより二重処理を抑えています。
- 同じ写真の再アップロードでpending/failed Sequenceを再処理できます。
- Homeはprocessing中に4秒間隔でpollします。

プロセス終了後も確実に再開する保証はありません。Issue #4を閉じるまでは、本番運用可能なbackground workerと表現しないでください。

### Location

EXIF GPSは約10km単位の`grid:...`キーへ変換し、厳密座標を保持しません。自動reverse geocodingはありません。

アップロード時に「神山」などの粗い場所名を手入力でき、その値はuser-origin / user-confirmedのprovenanceで保存されます。場所Heroを実行する場合は、自動判定ではなく手入力が必要です。

### Search

通常検索へ出せるClaimは、user confirmedまたは根拠付きmedium/high confidenceを基本とします。low confidence、disputed、Evidence参照のないAI Claimを通常回答へ混ぜないでください。

Memoryがprocessing中の場合はpartialとして返し、UIは「見つからない」と同時表示しない設計です。

### Settings

以下は設定項目だけ準備され、機能は意図的に無効化されています。

- [#7 検索学習](https://github.com/haya10hikawa-hub/AI-Hack/issues/7)
- [#8 カレンダー連携](https://github.com/haya10hikawa-hub/AI-Hack/issues/8)

バックエンド実装前にUIトグルだけ有効化しないでください。

### Auth / account lifecycle

メール確認callbackはありますが、実メールテンプレートとredirect URLは実環境で未検証です。password reset、データexport、アカウント全削除はIssue #9です。

### Database validation

初期migration、RLS、Storage policy、RPC、pgTAP testはあります。静的schema検査は成功済みですが、最終環境ではDocker daemonが利用できず、実Supabase/PostgreSQL上のpgTAPは未実行です。Issue #3で確認してください。

## 追加Issue

- [#9 アカウント復旧・データ書き出し・アカウント削除](https://github.com/haya10hikawa-hub/AI-Hack/issues/9)
- [#10 format:checkを全リポジトリで通してCIへ追加](https://github.com/haya10hikawa-hub/AI-Hack/issues/10)
- [#11 Phase 1の未決定プロダクト仕様](https://github.com/haya10hikawa-hub/AI-Hack/issues/11)
- [#13 GitHub ActionsのNode.js 20非推奨警告を解消](https://github.com/haya10hikawa-hub/AI-Hack/issues/13)

## 変更時に守る不変条件

- production pathへfake/demo dataを入れない。
- Evidenceを持たないAI Claimを確定事実として表示しない。
- 訂正時に古いClaimを上書きせず、UserCorrectionと新しいClaimを追記する。
- candidateを確認するときは、同じfieldの「最新Claim」ではなくGapが参照する正確なtarget claimを使う。
- 厳密なGPS座標や元画像をAI providerへ渡さない。
- 失敗またはprocessingを成功表示しない。
- user idはrequest bodyから受け取らず、検証済みAuth sessionから決定する。

## ローカル確認コマンド

```bash
pnpm install --frozen-lockfile
pnpm verify
node supabase/tests/static-schema.test.mjs
pnpm exec playwright install chromium
pnpm test:e2e
```

実サービス確認では`.env.example`を基に環境変数を設定し、秘密情報をcommitしないでください。

## 完成の判断

次の4項目が揃うまでは「コードMVP完成」、揃った後に「実環境デモ完成」と扱います。

1. 実Supabase / Storage / Auth / AIでHero Flowが完走する。
2. first EventとAI完了時間を実測する。
3. timeoutまたはprocess終了からAI jobが自動回復する。
4. 公開URLでsignup / upload / confirm / search / deleteのsmoke testが通る。
