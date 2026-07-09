---
name: spec-planning
description: |
  機能開発・バグ修正の計画・仕様策定時に使用するスキル。
  「実装したい」「機能を追加」「バグを直す」「〇〇を作る」で自動発動。
  要件が曖昧な場合はしつこく質問し、仮定で進めない。
allowed-tools: Read, Bash, Glob, Grep
execution_type: subagent
version: 1.0.0
updated: 2026-07-10
---

# Spec Planning

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/spec-planning/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
