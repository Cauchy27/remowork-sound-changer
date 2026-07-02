# Chrome DevTools MCP 利用ガイド

**フロントエンドの状態把握・デバッグには chrome-devtools MCP を使用すること。**

---

## 概要

Chrome DevTools MCPはブラウザの制御・検査・パフォーマンス分析を行うMCPサーバー。
Playwright MCPとは用途が異なるため、適切に使い分けること。

---

## ツール選択ガイドライン

### Chrome DevTools MCPを使用する場面

1. **パフォーマンス分析が必要な場合**
   - ページ読み込み速度の計測
   - レンダリングボトルネックの特定
   - Core Web Vitals の確認

2. **ネットワーク詳細分析が必要な場合**
   - APIレスポンス時間の計測
   - リクエスト/レスポンスヘッダーの確認
   - ペイロードサイズの分析

3. **DevTools準拠のデバッグが必要な場合**
   - コンソールログの詳細確認
   - JavaScript実行とデバッグ
   - DOMスナップショットの取得

### Playwright MCPを使用する場面

1. **E2Eテスト自動化**
2. **クロスブラウザテスト**（Firefox、WebKit含む）
3. **複雑なセレクタが必要な場合**（role、text等）

---

## 使用パターン

### パターン1: パフォーマンス分析

```
1. navigate_page でURLに移動
2. performance_start_trace でトレース開始
3. 対象操作を実行（ページ遷移、ボタンクリック等）
4. performance_stop_trace でトレース停止
5. performance_analyze_insight で分析結果取得
```

**プロンプト例**:
```
https://example.com のパフォーマンスを分析してください
```

### パターン2: ネットワークデバッグ

```
1. navigate_page でURLに移動
2. 操作を実行（フォーム送信、API呼び出し等）
3. list_network_requests でリクエスト一覧取得
4. get_network_request で詳細確認
```

**プロンプト例**:
```
このページのAPI呼び出しを確認し、レスポンス時間を分析してください
```

### パターン3: UI操作とスクリーンショット

```
1. navigate_page でURLに移動
2. take_screenshot で現在状態をキャプチャ
3. click / fill で操作
4. take_screenshot で操作後をキャプチャ
```

**プロンプト例**:
```
ログインフォームに入力し、送信前後のスクリーンショットを取得してください
```

### パターン4: コンソールエラー確認

```
1. navigate_page でURLに移動
2. list_console_messages でログ取得
3. エラーメッセージを分析
```

**プロンプト例**:
```
このページのJavaScriptエラーを確認してください
```

---

## ツール詳細

### 入力自動化

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `click` | 要素クリック | `selector: "#submit-btn"` |
| `fill` | テキスト入力 | `selector: "#email", value: "test@example.com"` |
| `fill_form` | フォーム一括入力 | `fields: [{selector, value}, ...]` |
| `hover` | ホバー | `selector: ".menu-item"` |
| `press_key` | キー入力 | `key: "Enter"` |
| `drag` | ドラッグ | `from, to` |
| `upload_file` | ファイルアップロード | `selector, filePath` |
| `handle_dialog` | ダイアログ処理 | `accept: true` |

### ナビゲーション

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `navigate_page` | URL移動 | `url: "https://example.com"` |
| `new_page` | 新規タブ | `url: "https://example.com"` |
| `close_page` | タブ閉じる | `pageId` |
| `list_pages` | タブ一覧 | - |
| `select_page` | タブ選択 | `pageId` |
| `wait_for` | 待機 | `selector` or `timeout` |

### パフォーマンス

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `performance_start_trace` | トレース開始 | - |
| `performance_stop_trace` | トレース停止 | - |
| `performance_analyze_insight` | 分析 | `category: "loading"` |

### ネットワーク

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `list_network_requests` | リクエスト一覧 | `filter: "api"` |
| `get_network_request` | 詳細取得 | `requestId` |

### デバッグ

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `take_screenshot` | スクリーンショット | `fullPage: true` |
| `take_snapshot` | DOMスナップショット | - |
| `evaluate_script` | JS実行 | `script: "document.title"` |
| `list_console_messages` | コンソールログ | `level: "error"` |
| `get_console_message` | ログ詳細 | `messageId` |

### エミュレーション

| ツール | 用途 | 引数例 |
|--------|------|--------|
| `emulate` | デバイスエミュレート | `device: "iPhone 12"` |
| `resize_page` | ビューポート変更 | `width: 1280, height: 720` |

---

## 注意事項

1. **ブラウザ起動**: ツール使用時に自動起動される（MCP接続のみでは起動しない）
2. **ユーザーデータ**: デフォルトで `~/.cache/chrome-devtools-mcp/chrome-profile-stable` を使用
3. **セキュリティ**: ブラウザ内容がMCPクライアントに公開される。機密情報の取り扱いに注意
4. **既存プロセス**: 接続エラー時は既存のChromeプロセスを終了してから再試行

---

## Playwright MCPとの併用

両方のMCPを導入している場合の使い分け:

| シナリオ | 推奨MCP |
|----------|---------|
| ページ読み込み速度計測 | Chrome DevTools |
| API応答時間分析 | Chrome DevTools |
| E2Eテストスイート実行 | Playwright |
| Firefox/Safari対応確認 | Playwright |
| コンソールエラー調査 | Chrome DevTools |
| フォーム入力テスト | どちらでも可（Playwrightの方がセレクタが強力） |
| スクリーンショット取得 | どちらでも可 |
