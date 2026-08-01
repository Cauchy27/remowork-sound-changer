---
name: roadmap-planning
description: |
  【何をするか】このスキルはプロダクトロードマップの作成・更新を行う。優先順位付け、四半期計画を構造化して `.claude/roadmap.md` に出力する。
  【いつ使うか】ロードマップ作成・更新・四半期計画策定の時に自動発動。
  【発動キーワード】「ロードマップ」「ロードマップ更新」「四半期計画」「ロードマップ策定」「四半期ゴール」「リリース計画」
  【他スキルとの違い】マイルストーンの期限管理は schedule-management を使用。
allowed-tools: Read, Bash, Glob, Grep
execution_type: standalone
version: 1.1.1
updated: 2026-08-02
---

# Roadmap Planning

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/roadmap-planning/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
