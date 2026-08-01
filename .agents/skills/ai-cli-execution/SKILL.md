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
updated: 2026-07-31
---

# Ai Cli Execution

Codex / Cursor / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/ai-cli-execution/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
