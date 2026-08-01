---
name: ai-cli-execution
description: |
  外部AIツール（Codex / Antigravity 等）を CLI 優先の3層モデルで実行するスキル。
  経路の優先順位は CLI > MCP > Claude 別視点。CLI 未設定時はセットアップ手順を必ず案内する。
  「Codexで実行」「Codexに聞いて」「agyで実行」「Antigravityで」「外部AIツール」「セカンドオピニオン」で自動発動。
  レビューでの利用は code-review、エージェント定義の検証は agent-review からも参照される。
allowed-tools: Read, Grep, Glob, Bash, mcp__codex__codex, mcp__codex__codex-reply
execution_type: standalone
version: 1.0.0
updated: 2026-07-30
---

# 外部AIツール実行スキル（CLI 優先・3層モデル）

## 使用宣言（必須）

このスキルを使用する際は、必ず最初に以下を出力すること：

```
[ai-cli-execution スキルを使用します]
```

## 概要

外部AIツール（Codex / Antigravity 等）を実行する際の経路選択と実行手順。
**経路の優先順位は CLI > MCP > Claude 別視点。** CLI が使えるのに MCP を選ぶのは違反。

## 実行フロー（要約）

```
Step 0: CLI の利用可否を判定（command -v codex && codex --version 等）
   ↓ 使える
Tier 1: CLI で実行（出力はファイルへ。タイムアウト由来の分割は不要）
   ↓ 使えない
CLI セットアップ手順を必ず案内（勝手に MCP へ落とさない）
   ↓ ユーザーが MCP を選択
Tier 2: MCP で実行（必ずタスク分割。1リクエストは数分でタイムアウトする）
   ↓ どちらも不可
Tier 3: Claude Code の別視点で代替（独立性が下がる旨を成果物に明記）
```

## 禁止事項（要点）

- CLI が使える環境で試行しない / CLI が使えるのに MCP を選ぶ
- MCP へ重いタスクを1発で投げる（必ず分割）
- 「とにかく待つ」「同じ重いリクエストを再投行する」
- Tier を下げた事実を成果物に書かない

## 詳細リファレンス

ツール別の実行手順・エラー別対処・利用制限時の対応・プロンプト設計は
[reference.md](reference.md) を正本とする。必要なステップで読み込むこと（遅延読み込み）。

Codex へのプロンプトは冒頭で「ゴールは〜」と成果を明示する
（設計ルール: [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md)）。

## 関連スキル

| スキル | 用途 |
|--------|------|
| [code-review](../code-review/SKILL.md) | Codex 併用の2系統並列レビュー |
| [agent-review](../agent-review/SKILL.md) | エージェント定義の Codex 独立レビュー |
| [development-orchestration](../development-orchestration/SKILL.md) | 標準開発フローからの利用 |

---

## Version History

| バージョン | 日付 | 変更内容 |
|-----------|------|----------|
| v1.0.0 | 2026-07-30 | docs/ai-cli-execution-policy.md の実行手順をスキル化（配置ポリシー「手順書は Skill へ」準拠）。手順全文は reference.md が正本 |
