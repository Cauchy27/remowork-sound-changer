---
name: ai-cli-execution
description: |
  実CLI3視点（Claude Code / Codex / Antigravity）を CLI 優先の3層モデルで実行するスキル。
  経路の優先順位は CLI > MCP > Claude 別視点。CLI 未設定・認証切れ時はセットアップ／フォールバック手順を必ず案内する。
  「Codexで実行」「Codexに聞いて」「agyで実行」「Antigravityで」「claude -pで実行」「外部AIツール」「セカンドオピニオン」で自動発動。
  レビューでの利用は code-review / internal-structure-review、エージェント定義の検証は agent-review からも参照される。
allowed-tools: Read, Grep, Glob, Bash, mcp__codex__codex, mcp__codex__codex-reply
execution_type: standalone
version: 1.1.4
updated: 2026-08-19
---

# Ai Cli Execution

Codex / Cursor / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/ai-cli-execution/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名（サブエージェント起動など）は、ツールごとに読み替えが必要です。
Cursor は独立サブエージェントを起動できないため、参照先エージェント定義の判断軸・手順を同一セッションで手動適用してください。Codex / Antigravity は利用可能な実行手段（コマンド実行・サブタスク等）があればそれを使い、なければ同様に手動適用してください。
