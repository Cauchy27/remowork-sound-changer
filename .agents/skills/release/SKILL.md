---
name: release
description: |
  リリース（プッシュ・ZIP作成）の手順とルール。
  バージョン更新、CHANGELOG追記、コードレビュー、git push、ZIP作成を行う。
  発動キーワード: リリース、release、プッシュ、push、zip、デプロイ
allowed-tools: Read, Bash, Glob, Grep
execution_type: standalone
version: 1.1.0
updated: 2026-07-10
---

# Release

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/release/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
