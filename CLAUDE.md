===
あなたはマネージャーでagentオーケストレーターです
あなたは絶対に実装せず、全てsubagentやtask agentに委託すること
タスクは超細分化し、PDCAサイクルを構築すること。
===

# Remowork Sound Changer

Remoworkの着信音・通知音をカスタマイズするChrome拡張機能。

## スキル

| スキル | 用途 | パス |
|-------|------|------|
| chrome-extension-dev | Chrome拡張開発ガイド | `.claude/skills/chrome-extension-dev/SKILL.md` |
| release | リリース手順 | `.claude/skills/release/SKILL.md` |
| code-review | 12視点マトリックスレビュー | `.claude/skills/code-review/SKILL.md` |
| wishlist | ウィッシュリスト管理 | `.claude/skills/wishlist/SKILL.md` |
| project-init | 新規プロジェクト作成 | `.claude/skills/project-init/SKILL.md` |
| research | 調査・リサーチ（技術/市場/法的/セキュリティ） | `.claude/skills/research/SKILL.md` |
| debugging | バグ調査・デバッグ | `.claude/skills/debugging/SKILL.md` |
| spec-planning | 計画・仕様策定 | `.claude/skills/spec-planning/SKILL.md` |

## 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| CHANGELOG.md | リリースノート |
| WISHLIST.md | 機能要望・改善案リスト |

## 概要

- **対象サイト**: https://stage.remowork.biz/, https://remowork.biz/
- **機能**: 5種類の音声（着信音、発信音など）をカスタマイズ
- **技術**: Manifest V3, Content Script, IndexedDB

## ファイル構成

```
remowork-sound-changer/
├── CLAUDE.md              # このファイル
├── manifest.json          # 拡張機能設定
├── background.js          # Service Worker（IndexedDB管理）
├── content.js             # Content Script（inject.js注入）
├── inject.js              # ページコンテキスト（Audioオーバーライド）
├── popup.html             # 設定UI
├── popup.js               # UI ロジック
├── popup.css              # スタイル
├── sounds/                # プリセット音声（後で追加）
└── icons/                 # 拡張機能アイコン
```

## 対象音声ファイル

| ID | パス | 用途 |
|----|------|------|
| calling | /client/calling.mp3 | 発信中（呼び出し音） |
| incoming | /client/incoming.mp3 | 着信音 |
| outgoing | /client/outgoing.mp3 | 発信音 |
| disconnect | /client/disconnect.mp3 | 切断音 |
| doorchime | /client/doorchime.mp3 | ドアチャイム |

## 音声設定オプション

1. **オリジナル** - Remoworkのデフォルト音声
2. **プリセット** - 拡張機能同梱の音声（sounds/フォルダ）
3. **カスタム** - ユーザーアップロード（最大300MB）

## 通信フロー

```
[inject.js (ページコンテキスト)]
    ↕ window.__remoworkSoundConfig
[content.js (Content Script)]
    ↕ chrome.runtime.sendMessage
[background.js (Service Worker)]
    ↕ IndexedDB / chrome.storage.local
[popup.js (設定UI)]
```

## 開発コマンド

```bash
# 拡張機能をChromeに読み込み
1. chrome://extensions/ を開く
2. デベロッパーモードを有効化
3. 「パッケージ化されていない拡張機能を読み込む」
4. remowork-sound-changer/ ディレクトリを選択

# Service Worker のログ確認
1. chrome://extensions/ で拡張機能を見つける
2. 「Service Worker を検証」をクリック
```

## テスト手順

1. 拡張機能をインストール
2. https://stage.remowork.biz/ にアクセス
3. ポップアップから音声設定を変更
4. 着信/発信テストでカスタム音声が再生されることを確認

## 注意事項

- プリセット音声を使用する場合は `sounds/` ディレクトリに mp3 ファイルを配置
- 音声ファイル名は `{id}.mp3` 形式（例: `incoming.mp3`）
- カスタム音声はBase64でIndexedDBに保存

---

## 技術アーキテクチャ：オフスクリーンドキュメント

### Chrome拡張の実行コンテキスト

Chrome拡張機能には複数の実行コンテキストがあり、それぞれ制約が異なる：

| コンテキスト | 特徴 | 制約 |
|------------|------|------|
| **Service Worker** (background.js) | 拡張機能のバックグラウンド処理 | DOM操作不可、永続化不可 |
| **Content Script** (content.js等) | Webページに注入されるスクリプト | ページのJSと分離された実行空間 |
| **ページコンテキスト** (inject.js) | Webページ本来のJS空間 | 拡張機能APIにアクセス不可 |
| **Offscreen Document** (offscreen.js) | 隠れたHTMLドキュメント | DOM操作可能、拡張機能API利用可能 |

### なぜオフスクリーン経由で処理するのか

#### 問題：ページコンテキストへのインジェクトの限界

当初、表情分析(face-api.js)をページコンテキストにインジェクトする方式を試みたが、以下の問題が発生：

1. **CSP (Content Security Policy) 制限**
   - Remoworkサイトの CSP により、インラインスクリプトがブロックされる
   - 設定を渡すためのインラインスクリプトが実行できない

2. **実行空間の分離**
   - Content Script と ページコンテキストは別の JavaScript 実行空間
   - `window.__remoworkExpressionAnalyzer` を Content Script から直接呼び出せない
   - カスタムイベントでの通信が必要になり、実装が複雑化

3. **拡張機能リソースへのアクセス**
   - ページコンテキストから `chrome-extension://` URL への fetch が失敗することがある
   - モデルファイルの読み込みに失敗

#### 解決：オフスクリーンドキュメント

```
┌─────────────────────────────────────────────────────────────┐
│ Webページ (remowork.biz)                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Content Script (hand-sign-detector.js)                  ││
│  │  - メンバー画像を検出                                     ││
│  │  - Canvas に画像を描画                                    ││
│  │  - ImageData を抽出                                       ││
│  └────────────────────────┬────────────────────────────────┘│
└───────────────────────────┼─────────────────────────────────┘
                            │ chrome.runtime.sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Service Worker (background.js)                              │
│  - メッセージをオフスクリーンに転送                           │
└────────────────────────────┬────────────────────────────────┘
                             │ message forwarding
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Offscreen Document (offscreen.html + offscreen.js)          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - MediaPipe (ハンドサイン検出)                           ││
│  │ - face-api.js (表情分析)                                 ││
│  │ - Web Speech API (文字起こし)                            ││
│  └─────────────────────────────────────────────────────────┘│
│  ✓ DOM操作可能 (Canvas, Image)                              │
│  ✓ 拡張機能リソースに直接アクセス可能                        │
│  ✓ CSP制限なし（拡張機能のCSPが適用）                        │
│  ✓ chrome.* API が利用可能                                  │
└─────────────────────────────────────────────────────────────┘
```

### オフスクリーンの利点

| 利点 | 説明 |
|------|------|
| **CSP回避** | 拡張機能独自のCSPが適用され、サイトのCSPに影響されない |
| **DOM操作** | Canvas, Image, Video などの DOM 要素が利用可能 |
| **リソースアクセス** | `chrome.runtime.getURL()` で拡張機能内のファイルに確実にアクセス |
| **API統一** | ハンドサインも表情分析も同じ通信パターンで実装できる |
| **デバッグ容易** | Service Worker の DevTools からログを確認できる |

### 実装パターン

```javascript
// Content Script (hand-sign-detector.js)
async function analyzeExpression(member) {
  // 1. 画像を Canvas に読み込み
  const canvas = await loadImageToCanvas(member.imageUrl);

  // 2. ImageData を抽出（縮小してサイズ削減）
  const imageData = ctx.getImageData(0, 0, width, height);

  // 3. オフスクリーンに送信
  const result = await chrome.runtime.sendMessage({
    type: 'ANALYZE_EXPRESSION',
    imageData: {
      data: Array.from(imageData.data),  // Uint8ClampedArray → Array
      width: imageData.width,
      height: imageData.height
    }
  });

  return result;
}

// Offscreen Document (offscreen.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EXPRESSION') {
    analyzeExpression(message.imageData).then(sendResponse);
    return true;  // 非同期レスポンスを示す
  }
});

async function analyzeExpression(imageData) {
  // ImageData から Canvas を作成
  const canvas = document.getElementById('canvas');
  ctx.putImageData(new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  ), 0, 0);

  // face-api.js で分析
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions())
    .withFaceExpressions();

  return { success: true, expressions: ... };
}
```

### 注意点

1. **ImageData のシリアライズ**
   - `Uint8ClampedArray` はメッセージで送信できないため `Array.from()` で変換
   - 受信側で `new Uint8ClampedArray()` に戻す

2. **画像サイズの最適化**
   - 大きな画像はメッセージサイズが膨大になる
   - 256px 程度に縮小してから送信

3. **非同期レスポンス**
   - `addListener` のコールバックで `return true` を返す
   - `sendResponse` を非同期で呼び出し可能にする


---

## 🔄 起動時必須アクション

**AIを起動した際、作業開始前に必ず以下を実行すること：**

```bash
# リモートの変更を取得
git pull
```

**理由:** 他の開発者やAIエージェントによる変更を取り込み、コンフリクトを防止する。

---


---

## 🌐 フロントエンド状態把握

**フロントエンドの状態把握・デバッグには chrome-devtools MCP を使用すること。**

---

# Chrome DevTools MCP Skills

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

---

