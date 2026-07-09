---
name: code-review
description: |
  コードレビューの手順とチェックリスト。
  12視点マトリックスレビュー（3ペルソナ × 4カテゴリ）を実施。
  発動キーワード: レビュー、review、チェック、確認
allowed-tools: Read, Bash, Glob, Grep
execution_type: agent-teams
version: 1.2.0
updated: 2026-07-10
---

# Code Review

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/code-review/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
