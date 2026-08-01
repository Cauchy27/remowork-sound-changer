---
name: code-review
description: |
  フルスタック統合コードレビュースキル。
  「レビュー」「PRレビュー」「コードを確認」で発動。
  デザインは design-critique、文書は document-review、エージェント定義は agent-review、
  スキル構造は internal-structure-review を使用。
  Claude Code + Codex の2系統並列レビューを実行（Codex は CLI 優先・MCP フォールバック。利用不可時は代替モード）。
allowed-tools: Read, Bash, Glob, Grep
execution_type: agent-teams
version: 2.9.0
updated: 2026-08-02
---

# Code Review

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/code-review/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
