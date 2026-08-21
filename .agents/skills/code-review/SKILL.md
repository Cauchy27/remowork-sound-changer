---
name: code-review
description: |
  フルスタック統合コードレビュースキル。
  「レビュー」「PRレビュー」「コードを確認」で発動。
  デザインは design-critique、文書は document-review、エージェント定義は agent-review、
  スキル構造は internal-structure-review を使用。
  視点・観点・裁定ルールの正本は `.claude/docs/review-matrix.md`。対象はコード実装、使う視点は Claude Code / Codex / Antigravity（3視点・実CLI優先）、使う観点は 1/2/3/4/7（+ 該当時 6・9）。
  全モード共通の横断ゲートとして本質ギャルレビュー（essence-gyaru-review）を Round 1 先頭で1回実行する（単独発動キーワードは essence-gyaru-review 側に限る）。
allowed-tools: Read, Bash, Glob, Grep
execution_type: agent-teams
version: 3.3.0
updated: 2026-08-21
---

# Code Review

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/code-review/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
