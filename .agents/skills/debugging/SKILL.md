---
name: debugging
description: |
  Chrome拡張機能のバグ調査・デバッグ時に使用するスキル。
  「デバッグ」「バグ」「エラー」「不具合」「動かない」で自動発動。
  問題切り分け、ログ分析、再現手順確認を提供。
allowed-tools: Read, Bash, Glob, Grep
execution_type: agent-teams
version: 1.0.0
updated: 2026-07-10
---

# Debugging

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/debugging/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
