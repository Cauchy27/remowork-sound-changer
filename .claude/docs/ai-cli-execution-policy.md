---
type: Reference
title: 外部AIツール実行ポリシー（CLI 優先・3層モデル）
description: Claude Code（claude -p）/ Codex / Antigravity を呼ぶ経路の優先順位（CLI > MCP > Claude 別視点）、各ツールの強みと担当領域、CLI 未設定時のセットアップ案内、検証済みコマンド仕様
tags: [claude-code, codex, antigravity, cli, mcp, review, policy, fallback]
timestamp: 2026-08-02T00:00:00Z
---

# 外部AIツール実行ポリシー（CLI 優先・3層モデル）

Claude Code（`claude -p`。オーケストレーター本体からのネスト起動を含む）/ Codex / Antigravity という**3視点**を呼ぶ際の経路と担当領域を定める。**Claude Code 自身も対象に含む**（別プロセスとして起動する `claude -p` を、Codex/Antigravity と同格の視点として扱う）。
プロンプトの書き方は [Codex プロンプト設計ガイドライン](codex-prompt-guideline.md) を参照（本ポリシーは経路と役割、あちらは中身）。Codex へ渡す全プロンプトには【モデル運用】ブロック（監督 = Sol / 実作業 = Luna Max / 大問題時のみ Sol・Terra）を必ず含める（省略不可。ブロック原文は同ガイドライン参照）。 【スコープ】ブロック（ゴール外の作業禁止・着手前の目的/代償/停止条件の自己確認3点）も必ず続けて含める。さらに**実装・修正を依頼する場合は【レビュー粒度】ブロック**（ループは「1ページ / 1機能」単位・実装単位が動作した時点で1回だけ・修正は P0/P1 のみ・再確認は修正差分に限定・1単位ごとにコミット）も必ず含める（レビュー専用依頼には入れない）。いずれも省略不可で、ブロック原文は同ガイドラインを正本とする。 なお **Luna の reasoning effort は必ず `max` を明示する**（`gpt-5.6-luna` の既定は `medium` のため、無指定では max にならない）。

**本ファイルが方針（対象ツールと担当領域・経路の優先順位）の正本。実行手順の正本は [ai-cli-execution スキルの reference.md](../skills/ai-cli-execution/reference.md)。**

---

## 1. 対象ツールと担当領域

**同じ「別視点」でも強みが違う。** 本節が扱うのはツールの一般的な強み（経路選択・ルーティングの判断材料）であり、レビュー文脈での観点割り当て（誰が観点1〜9のどれを主担当するか）は `.claude/docs/review-matrix.md`「第1層: 視点」の交差表が正本である（**本節では観点番号による割り当てを再掲しない**）。

| ツール | CLI | 強み |
|--------|-----|------|
| **Claude Code** | `claude -p`（オーケストレーター本体からのネスト起動。別プロセスとして独立実行） | 大コンテキスト推論、プロジェクト固有規約の理解、Agent Teams 並列実行 |
| **Codex**（GPT-5.6 系） | `codex exec` | 実行・デバッグ・長期タスクの持続性。指摘が具体的で実行可能。ゴールへの執着が強く、中途半端な結論で止まらない |
| **Antigravity**（`agy`。マルチモデル基盤） | `agy --model gemini-3.1-pro-high` | **Gemini 3.1 Pro 指定時**、視覚・空間推論とデザインで主要マルチモーダルベンチマーク首位級。2D UI/UX とグラフィカルプログラミングの理解が native |

### 観点の割り当て指針

- **実装・仕様・セキュリティのレビュー** → Codex を主、Antigravity を補
- **画面・デザイン・ドキュメントの構造や見通し** → Antigravity を主、Codex を補
- **両方が同じ問題を指摘した場合** → 信頼度が上がる。片方だけの指摘は事実照合（`code-review-fact-check`）へ回す
- ツールの強みと無関係な観点を割り当てない（Antigravity に SQL インジェクション検査だけをやらせる等）
- 観点番号（1〜9）での具体的な割り当ては `review-matrix.md` の交差表に従う。本節の指針はツール選定の一般則であり、観点番号による割り当てを本節で独自に定義しない

> 根拠: Codex は Artificial Analysis Coding Agent Index で Codex harness 首位、長期実行・ツール使用・エージェント制御が native。Gemini 3 系は視覚・空間推論ベンチマークとウェブサイトデザイン評価で首位。
>
> ⚠️ **`agy` は Gemini 専用ではない**（Claude・GPT-OSS も選べる）。既定は Gemini 3.6 Flash のため、上記の強みを得るには `--model` の明示が必須。詳細は [ai-cli-execution スキルの reference.md](../skills/ai-cli-execution/reference.md) §6。

---

## 2. 経路の優先順位（全ツール共通）

| Tier | 手段 | 使う条件 |
|------|------|----------|
| **1** | **各ツールの CLI**（`claude -p` / `codex exec` / `agy -p`） | **既定**。PATH にあり認証済みなら必ずこちら |
| 2 | MCP（`mcp__codex__codex` 等） | CLI が使えない場合のみ。**Codex のみ対応・タスク分割必須** |
| 3 | Claude Code の別視点サブエージェント（`.claude/agents/llm-personas/`）、または Claude Code 自身が親セッションで直接実施 | 実ツールが使えない場合の代替 |

※ **Antigravity と Claude Code は MCP 経路（Tier 2）を持たない。** CLI 不可時はどちらも Tier 2 を飛ばして直接 Tier 3（Claude 別視点、または Claude Code 自身が親セッションで直接実施）へ移る。

**CLI を飛ばして MCP・Claude 代替を選ぶことは禁止。** Tier を下げるたびに理由を成果物へ記録する。

### CLI を最優先する理由

| 観点 | CLI | MCP |
|------|-----|-----|
| タイムアウト | Bash tool 側で制御可能。長時間タスクを1発で投げられる | 1リクエスト数分で MCP タイムアウト。**タスク分割が必須** |
| 結果の回収 | `-o FILE` で最終メッセージだけをファイル取得 | タイムアウトするとファイル書き出しも消える |
| コンテキスト | 出力をファイルへ逃がせるためメインを圧迫しない（実測: 1レビューの生ログは数百KB規模） | 応答が丸ごとコンテキストに載る |
| レビュー機能 | `codex exec review` のネイティブ差分レビューが使える | 相当機能なし |
| 権限制御 | `-s read-only` でサンドボックス指定 | MCP サーバー設定に依存 |

---

## 実行手順（移管済み）

実行手順（実行前準備・CLI セットアップ案内・Tier 1/2/3 の詳細・利用制限時の対応・禁止事項）は
**[ai-cli-execution スキル](../skills/ai-cli-execution/SKILL.md)** へ移管した
（配置ポリシー「手順書は Skill へ」準拠。2026-07-30）。

本ドキュメントは**方針**（担当領域・経路の優先順位）のみを扱う。役割分担は冒頭を参照。
