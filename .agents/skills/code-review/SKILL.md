---
name: code-review
description: |
  フルスタック統合コードレビュースキル。
  「レビュー」「PRレビュー」「コードを確認」で発動。
  デザインは design-critique、文書は document-review、エージェント定義は agent-review、
  スキル構造は internal-structure-review を使用。
  視点・観点・裁定ルールの正本は `.claude/docs/review-matrix.md`。対象はコード実装、使う視点は Claude Code / Codex / Antigravity（3視点・実CLI優先）、使う観点は 1/2/3/4/7（+ 該当時 6・9）。
  全モード共通の横断ゲートとして本質ギャルレビュー（essence-gyaru-review）を Round 1 先頭で1回実行する（単独発動キーワードは essence-gyaru-review 側に限る）。
allowed-tools: Read, Grep, Glob, Bash, Task, mcp__codex__codex, mcp__codex__codex-reply
execution_type: agent-teams
version: 3.2.3
updated: 2026-08-19
---

# Code Review

Codex / Cursor / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/code-review/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名（サブエージェント起動など）は、ツールごとに読み替えが必要です。
Cursor は独立サブエージェントを起動できないため、参照先エージェント定義の判断軸・手順を同一セッションで手動適用してください。Codex / Antigravity は利用可能な実行手段（コマンド実行・サブタスク等）があればそれを使い、なければ同様に手動適用してください。
