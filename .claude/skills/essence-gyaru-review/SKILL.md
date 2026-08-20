---
name: essence-gyaru-review
description: |
  【何をするか】成果物の目的・意思決定・前提・因果・矛盾・業務上の代償・次アクションの7軸を、快活なギャル口調で根拠付きに突く独立レビューを実行する。
  【いつ使うか】「ギャルレビュー」「本質ギャル」「本質を突いて」の**単独依頼**で直接発動する。一般的な「レビューして」は code-review スキルだけが発動し、本スキルは code-review が内部的に1回呼ぶ（本スキル単独では発動しない）。
  【発動キーワード】「ギャルレビュー」「本質ギャル」「本質を突いて」
allowed-tools: Task, Read, Grep, Glob, Write, Bash
execution_type: subagent
version: 1.1.0
updated: 2026-08-11
---

# 本質ギャルレビュー

## 使用宣言（必須）

```text
[essence-gyaru-review スキルを使用します]
[essence-gyaru-reviewer エージェントが参加しました]
視点: 目的、意思決定、前提、因果、矛盾、業務上の代償、次アクション
参照: .claude/agents/llm-personas/essence-gyaru-reviewer.md
```

## 概要

人格・判断軸・出力フォーマットは [エージェント定義](../../agents/llm-personas/essence-gyaru-reviewer.md)を正本とし、起動手順と質問バンクは本スキルと [reference.md](./reference.md) を正本とする。
表層デザインや技術詳細の指摘は主務外（design-critique / code-review の他視点に委ねる）。判断軸は目的→意思決定→前提→因果→矛盾→業務上の代償→次アクションの7段階で固定する。

## 技術情報の参照

ライブラリ・フレームワークの仕様は記憶に頼らず Context7 MCP で最新を取得する。手順と使う場面: [technical-reference-lookup.md](../../docs/technical-reference-lookup.md)

## コンテキスト節約

サブエージェントへの委託、結果のファイル書き出し、部分読み、遅延読み込みでコンテキスト肥大を防ぐ。詳細: [context-management.md](../../docs/context-management.md)

## 発動条件とルーティング

- 「ギャルレビュー」「本質ギャル」「本質を突いて」など本質ギャル単独を明示的に求める依頼だけ、本スキルを直接発動する
- 一般的な「レビューして」だけの依頼では単独発動しない。`code-review` スキルが統合レビューの1視点として内部的に呼ぶ
- 修正後に再レビューする場合は `review-iteration` を1つ加算し、前反復のレポートは読まずに再評価する

| 環境 | 実行経路 |
|---|---|
| Claude Code | Task で `subagent_type="essence-gyaru-reviewer"` を起動 |
| Codex / Antigravity 等 | [ai-cli-execution](../ai-cli-execution/SKILL.md) の3層モデル（CLI優先）に従い、同じエージェント正本とreference.mdを参照させる |
| Cursor | 独立サブエージェント起動手段を持たないため、下記「Cursor での手動実行手順」に従う |

独立サブエージェントを起動できない環境だけ、他レビュアーの結果を読む前に、同一セッションでエージェント正本の判断軸を手動適用する。

### Cursor での手動実行手順

1. `{対象}` と `{review-iteration}` を確認する
2. [reference.md](./reference.md) セクション3（7軸・出力フォーマット）を、他レビュアーの結果を読まずに同一セッション内で判断軸として手動適用する
3. 出力フォーマットどおりに `{出力先}` へ手動で保存する
4. `python3 .claude/skills/essence-gyaru-review/scripts/validate_report.py --report {出力先} --iteration {review-iteration}` を実行し構造を検証する
5. `ERROR` が出た場合は該当箇所を修正し、手順4を再実行する

## 入力と出力

| 変数 | 内容 |
|---|---|
| `{対象}` | レビュー対象のパスまたは範囲の説明 |
| `{review-iteration}` | 初回1、修正後の再レビューごとに加算する正整数 |
| `{出力先}` | レポートの保存パス。単独依頼は `.tmp/essence-gyaru-review/round-{review-iteration}/report.md`、`code-review` 経由時は呼び出し元が指定するパス |

レポートは通常の Write で `{出力先}` に保存する単純フローとする（排他制御・digest固定・atomic公開は行わない）。

## Instructions

1. `{対象}` と `{review-iteration}` を確認し、単独依頼なら `{出力先}` を上記デフォルトで決める。`code-review` 経由なら呼び出し元が指定した `{出力先}` をそのまま使う。
2. Task で `essence-gyaru-reviewer` を起動する。

   ```text
   Task(
     subagent_type="essence-gyaru-reviewer",
     description="本質ギャルレビュー iteration {review-iteration}",
     prompt="
       .claude/agents/llm-personas/essence-gyaru-reviewer.md と
       .claude/skills/essence-gyaru-review/reference.md だけを
       判断軸・出力フォーマットの正本として読むこと。
       対象: {対象}
       review-iteration: {review-iteration}
       出力先: {出力先}
       対象本体と関連する正本を確認し、reference.md の出力フォーマットで
       {出力先} へ書き込むこと。他レビュアーの結果は読まないこと。
       本文への返答は3-5行（結論・指摘件数・全指摘ID）に収めること。
     "
   )
   ```

3. `python3 .claude/skills/essence-gyaru-review/scripts/validate_report.py --report {出力先} --iteration {review-iteration}` で構造を検証する。`ERROR` が出たら該当箇所を修正して再実行する。
4. 単独依頼はレポートのパス・指摘件数・全指摘IDを呼び出し元へ返して完了する。
5. `code-review` 経由の場合は、全指摘IDを code-review-fact-check（本拠点未保有）へ引き渡す想定だが、この拠点では未配備のため引き渡し不要。通常の並列レビュー指摘と同じ4判定（妥当/部分的に妥当/過剰/事実誤認）で検証される前提は、fact-check配備後に有効化する。

## Checklist

- [ ] 単独発動は固有キーワード（「ギャルレビュー」「本質ギャル」「本質を突いて」）でのみ行い、一般的な「レビューして」では発動しなかった
- [ ] エージェント正本とreference.mdだけを判断軸・出力フォーマットの根拠にした
- [ ] `validate_report.py` の検証を実行し、ERRORが出ないことを確認した
- [ ] 指摘0件でも定型文を出力させた
- [ ] `code-review` 経由の場合は全指摘IDをfact-checkへ引き渡す前提を明記した

## ローカライズ

`post-import-setup`（新規導入時）と `template-rollout`（横展開時）で、各プロジェクトに合わせて次を確認・調整する。

| # | 項目 | 確認内容 |
|---|------|----------|
| 1 | 質問バンクのドメイン反映 | [reference.md](./reference.md) の質問バンクに、プロジェクトのドメイン用語・業務文脈（例: EC/SaaS/社内ツール等）を反映したか |
| 2 | 成果物種別に応じた重み付け | レビュー対象がコード中心か仕様書・レポート中心かで、7軸のうちどれを重点確認するかの重み付けを調整したか（例: 仕様書は前提・因果を重視、実装コードは矛盾・業務上の代償を重視） |
| 3 | 発動キーワードの競合確認 | プロジェクト固有スキルに「ギャルレビュー」「本質ギャル」「本質を突いて」と衝突する発動キーワードがないか確認したか |
| 4 | 口調カスタマイズの可否 | ペルソナの7軸・出力フォーマットは変更禁止。口調（一人称・語尾等）だけプロジェクトの慣習に合わせて調整可能かを判断したか |

**2026-08-11 導入時判定**: ドメイン反映あり（対象成果物: Remoworkの着信音・通知音をカスタマイズするChrome拡張機能）。[reference.md](./reference.md) の質問バンクへ、応対品質への影響（1.1目的）・本番/ステージング差異（1.3前提）・着信見逃し等の業務事故リスク（1.6業務上の代償）の3設問を追加。

## 失敗の記録と反映

このスキルの実行で失敗・見落とし・誤りが起きたら、その場で下表に追記し、本文の該当箇所も直す。規約: [skill-self-improvement.md](../../docs/skill-self-improvement.md)

| 日付 | 失敗の内容 | 原因 | 反映した対策 |
|---|---|---|---|
| 2026-08-11 | （まだ記録なし） | 既存プロジェクトの類似スキルから軽量移植した初版のため未発生 | - |

## Version History

| バージョン | 日付 | 変更内容 |
|---|---|---|
| v1.1.0 | 2026-08-11 | 内部構造レビュー指摘を反映。allowed-tools に `Bash`（Instructions Step 3 の `validate_report.py` CLI 実行用）を追加。発動条件とルーティング表に Cursor 専用行と「Cursor での手動実行手順」小節を追加 |
| v1.0.0 | 2026-08-11 | 既存プロジェクトの本質ギャルレビューを軽量・汎用版として初版移植。排他claim/digest固定/atomic公開を廃し通常Writeフローに簡素化 |
