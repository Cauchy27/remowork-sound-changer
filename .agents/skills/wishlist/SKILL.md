---
name: wishlist
description: |
  ウィッシュリスト（機能要望・改善案）の管理。
  今後実装したい機能や改善案を記録・追跡する。
  発動キーワード: ウィッシュリスト、wishlist、今後、要望、改善案、TODO
allowed-tools: Read, Bash, Glob, Grep
execution_type: standalone
version: 1.0.0
updated: 2026-07-10
---

# Wishlist

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/wishlist/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
