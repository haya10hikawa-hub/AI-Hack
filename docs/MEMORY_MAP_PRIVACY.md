# Memory Exploration Map privacy contract

Phase 1 の Memory Map は、記憶のある地域を六角形のセルとして表示する。一般的な地図や現在地追跡ではない。

## 位置情報のライフサイクル

1. ユーザーが Map 画面の「現在地から地図をひらく」を押したときだけ、ブラウザの Geolocation API を呼ぶ。
2. 緯度・経度はブラウザのコールバック内だけで扱い、`h3-js` で H3 resolution 10 のセル ID に変換する。
3. 変換後はセル ID だけを API に送る。緯度・経度、精度、移動履歴は state、ログ、DB、AI payload に保存しない。
4. サーバーは H3 セル ID の妥当性と resolution を再検証し、認証ユーザー本人の行だけを作成する。

Resolution 10 は平均辺長が約 76 m で、セルの幅がおおむね 100〜200 m になるため採用した。セル ID から地域を完全に秘匿できるわけではないため、これは匿名化ではなくデータ最小化である。

## 外部送信と表示

- Map UI はアプリ内の抽象的な Fog Grid を描画し、Google Maps、Mapbox、OpenStreetMap その他のタイルを読み込まない。
- Map データを外部 AI Provider に送らない。
- 既存 Memory に正当な H3 関連付けがない場合、推測でセルへ配置しない。既存の粗い場所情報は別の「粗い地域」一覧に表示する。
- 位置許可が拒否・未対応でも、保存済みセルと粗い地域は閲覧できる。

## 保存、分離、削除

- `memory_map_cells` は `user_id + cell_id` を所有境界とし、RLS で本人のみ読み取り可能。
- Reveal は service-only RPC、削除は本人に限定した server route から実行する。
- 同じセルの Reveal は冪等で、状態は `fog -> outline -> revealed -> memory` の順にのみ進む。
- Memory との関連は外部キーで削除に追従し、アカウント削除時はセルと関連を cascade 削除する。
- 設定画面から Memory Map を無効化でき、保存済み Map データを明示的に全消去できる。

## Phase 2 の接続点

`MemoryOpportunityCandidate` と `OpportunityRadius` は通知をまだ送らない純粋な型として置く。将来の Opportunity はセル ID とユーザー設定だけを入力にし、バックグラウンドで正確な移動履歴を収集しない。通知、OS 権限、頻度制限、時刻条件、監査は Phase 2 で別途設計・レビューする。
