---
name: essence-gyaru-review
description: |
  【何をするか】成果物の目的・意思決定・前提・因果・矛盾・業務上の代償・次アクションの7軸を、快活なギャル口調で根拠付きに突く独立レビューを実行する。
  【いつ使うか】「ギャルレビュー」「本質ギャル」「本質を突いて」の**単独依頼**で直接発動する。一般的な「レビューして」は code-review スキルだけが発動し、本スキルは code-review が内部的に1回呼ぶ（本スキル単独では発動しない）。
  【発動キーワード】「ギャルレビュー」「本質ギャル」「本質を突いて」
allowed-tools: Read, Bash, Glob, Grep
execution_type: subagent
version: 1.1.0
updated: 2026-08-17
---

# Essence Gyaru Review

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/essence-gyaru-review/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
