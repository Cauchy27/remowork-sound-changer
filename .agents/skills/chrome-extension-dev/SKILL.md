---
name: chrome-extension-dev
description: |
  Chrome拡張機能の開発ガイドライン。
  Manifest V3準拠、セキュリティ、パフォーマンス最適化。
  発動キーワード: Chrome拡張、extension、manifest、content script、background script
allowed-tools: Read, Bash, Glob, Grep
execution_type: standalone
version: 1.3.0
updated: 2026-07-10
---

# Chrome Extension Dev

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/chrome-extension-dev/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
