# Remowork Sound Changer

Remoworkの着信音・通知音をカスタマイズするChrome拡張機能。

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
