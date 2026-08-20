---
name: architecture
description: |
  【何をするか】このスキルはチームの意思決定を ADR（決定記録）として `.docs/adr/` に正本化する。技術選定・アーキテクチャ決定に加え、仕様解釈・データモデル・業務ルール・採否といった業務判断も同じ契約で記録する。status のライフサイクル、追跡可能な証跡、確定後の本文不変、後続 ADR による置換を定める。
  【いつ使うか】技術選定・アーキテクチャ決定・設計方針を記録する時、および実装中に仕様解釈・採否・API・データモデル・業務ルールを判断する直前に自動発動。「これで決まり」「この方針で」など決定が確定した発言でも発動する。
  【発動キーワード】「ADR」「アーキテクチャ決定」「技術選定」「決定を記録」「判断を確定」「過去の決定を確認」「決定記録」
  【他スキルとの違い】現在実装すべき要件・受入条件は spec-planning。誰がいつ何をやるかは ticket-creation。更新され続ける How-to・知見は knowledge-base-management（ADR 本文は扱わず、リンクと要約に留める）。本スキルは「なぜその選択をしたか、何を捨てたか、どんな代償を払ったか、いつ再検討するか」を正本として固定する点が異なる。
allowed-tools: Read, Bash, Glob, Grep
execution_type: hybrid
version: 2.0.0
updated: 2026-08-20
---

# Architecture

Codex / Antigravity (Gemini) 共通の参照ラッパー。

**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/architecture/SKILL.md` に記載されています。**
エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。

Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。
