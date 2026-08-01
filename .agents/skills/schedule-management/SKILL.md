---
name: schedule-management
description: |
  スケジュール・マイルストーン・期限管理スキル（3層モデルの L2: 時間層）。
  【何をするか】`.claude/schedule.md`（期限とマイルストーンの単一ソース）の作成・更新を行う。`.claude/schedule.md` への書き込みは本スキルの専権であり、roadmap-planning / sprint-planning / ticket-creation は情報を引き渡す・報告するだけで直接編集しない。
  【いつ使うか】スケジュール確認・期限管理・マイルストーンの追加/更新/完了判定の時に自動発動。
  【発動キーワード】「スケジュール」「期限」「いつまで」「マイルストーン」
  【他スキルとの違い】ロードマップの中身の組み替えは roadmap-planning、チケット単位の実行管理は ticket-creation を使用。Claude Code の定期実行タスク（cron）の設定は scheduled-task-setup を使用。
allowed-tools: Read, Bash, Glob, Grep
execution_type: standalone
version: 1.2.0
updated: 2026-08-02
---

# Schedule Management

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/schedule-management/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
