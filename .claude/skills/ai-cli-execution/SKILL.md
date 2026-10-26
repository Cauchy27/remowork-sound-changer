---
name: ai-cli-execution
description: |
  実CLI3視点（Claude Code / Codex / Antigravity）を CLI 優先の3層モデルで実行するスキル。
  経路の優先順位は CLI > MCP > 親セッション上の別視点。CLI 未設定・認証切れ時はセットアップ／フォールバック手順を必ず案内する。
  「Codexで実行」「Codexに聞いて」「agyで実行」「Antigravityで」「claude -pで実行」「外部AIツール」「セカンドオピニオン」で自動発動。
  レビューでの利用は code-review / internal-structure-review、エージェント定義の検証は agent-review からも参照される。
allowed-tools: Read, Grep, Glob, Bash, mcp__codex__codex, mcp__codex__codex-reply
execution_type: standalone
version: 1.1.11
updated: 2026-09-18
---

# AIツール実行スキル（実CLI3視点・CLI 優先・3層モデル）

## 使用宣言（必須）

作業開始時に `[ai-cli-execution スキルを使用します]` と宣言する。

## 概要

**Claude Code（`claude -p`）/ Codex / Antigravity の3視点**を実行する際の経路選択と実行手順。
Claude Code 視点は、**親セッション（オーケストレーター）とは別プロセスとして起動する `claude -p`** で実行する（review-matrix.md が定める第1層3視点のうちの1つ。親が Claude Code ならネスト起動になる）。
**経路の優先順位は CLI > MCP > 親セッション上の別視点。** CLI が使えるのに MCP を選ぶのは違反。
親セッションが Claude Code 以外（Codex・Antigravity）のときは、[reference.md](reference.md)「実行役ごとの読み替え」節で手順を読み替える。

## 実行フロー（要約）

```
Step 0: CLI の利用可否を判定（command -v claude/codex/agy && {cmd} --version 等）
   ↓ 使える
有料 API への接続確認（従量課金に接続しうる・判定できない → CLI を呼ばずに止め、オペレーターへ確認）
   ↓ 問題なし
Tier 1: CLI で実行（出力はファイルへ。Claude Code が実行役なら長時間の起動は背景実行。タイムアウト由来の分割は不要）
   ↓ 使えない（未設定 / OAuth 失効・認証切れ等）
CLI セットアップ手順を案内し、止めずに下位 Tier で続行（成果物に「{ツール} CLI 未設定のため Tier {n} で実施」と明記）
   ↓ Codex
Tier 2: MCP で実行（Codex のみ対応。移る前に有料 API への接続確認を行う。必ずタスク分割。1リクエストは数分でタイムアウトする）
   ↓ どちらも不可、または Tier 2 を持たないツール（Claude Code / Antigravity）
Tier 3: 親セッション上の別視点（ペルソナ）で代替、または親自身が同一セッションで直接実施
   （独立性が下がる旨を成果物に明記）
```

**案内を出したら判断を仰いで止まらず、下位 Tier で続行する**（正本は [reference.md](reference.md) §4）。例外は、有料 API への接続確認で止める条件に当たった場合で、このときは止めてオペレーターへ確認する（[reference.md](reference.md) §3「有料 API への接続確認」）。利用上限に達した場合は、有料へ切り替えずに定額の別ツールの視点か Tier 3 で続行し、先へ進む手段が従量課金の接続しか無いときだけ止める（[reference.md](reference.md) §6.5）。

**Claude Code（`claude -p`）は Antigravity と同じく Tier 2（MCP）を持たない。** 未設定または OAuth 失効時は Tier 3 へ直接フォールバックする（判定方法・手順は [reference.md](reference.md) §4.5）。

## 禁止事項（要点）

- 有料 API（従量課金）に接続しうる・判定できないまま CLI を呼ぶ、または利用上限時に有料への切り替えを受け入れる（[reference.md](reference.md) §3「有料 API への接続確認」）
- CLI が使える環境で試行しない / CLI が使えるのに MCP を選ぶ
- MCP へ重いタスクを1発で投げる（必ず分割）
- 「とにかく待つ」「同じ重いリクエストを再投行する」（`claude -p` の OAuth 再認証要求に対して再試行を繰り返すことも含む）
- Tier を下げた事実を成果物に書かない
- `claude` の `--allowedTools` と `--tools` を混同する（意味が異なる。詳細は reference.md §4.5 Step 1）

## 詳細リファレンス

ツール別の実行手順・エラー別対処・利用制限時の対応・プロンプト設計は
[reference.md](reference.md) を正本とする。必要なステップで読み込むこと（遅延読み込み）。

Codexへの各依頼は、冒頭のゴール文直後に [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md) の【モデル運用】【スコープ】を全文展開し、送信本文で確認する。CLI は [reference.md](reference.md) §5の組立・grep・stdin送信を使う。Bashを使わない経路も同ガイドラインのRead・文字列展開・送信前確認に従い、参照だけで済ませない。

**Codex に実装・修正をさせる場合は、続けて【レビュー粒度】ブロック（ループは「1ページ / 1機能」単位・実装単位が動作したら1回だけ・修正は P0/P1 のみ・再確認は差分限定）も原文のまま必ず含める。** 省略すると Codex はファイル追加のたびにレビューを回し、実装が進まないまま利用枠だけ消費する。ブロック原文は同じく [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md)、粒度の定義の正本は impl-review-loop の「レビュー粒度」セクション。レビュー専用依頼（Codex がレビュアーとして1回動くだけ）には含めない。

## 関連スキル

| スキル | 用途 |
|--------|------|
| [code-review](../code-review/SKILL.md) | Codex 併用の2系統並列レビュー |

---

## Version History

| バージョン | 日付 | 変更内容 |
|-----------|------|----------|
| v1.1.11 | 2026-09-18 | Codex 起動例の reasoning effort を親セッションの実測既定 xhigh へ揃え、【モデル運用】正本（codex-prompt-guideline.md）の「委託は明示起動に限る」改訂に追従 |
| v1.1.10 | 2026-09-18 | reference.md §6 の `agy models` 表を agy 1.2.5 実測へ更新（3.7 / 3.8 Flash 追加・3.5 Flash 削除）し、既定モデルを実測で 3.8 Flash へ訂正。1.1.10 以前の `--model` 無視の注意と、ログで実モデルを確かめる手順を追記。ai-cli-execution-policy.md と antigravity ペルソナの既定モデル記述も追従 |
| v1.1.9 | 2026-09-08 | 実装用プロンプトのコミット指示を元ユーザーの明示依頼時に限定し、依頼がない場合は検証済み・未コミットで完了する条件を明記 |
| v1.1.8 | 2026-09-06 | 正本ブロックの抽出・送信前確認・stdin送信を標準化し、非Bash経路も原文展開に統一 |
| v1.1.7 | 2026-09-06 | Claudeレビューの要求モデル明示・実行モデル証拠の記録と通常設定の権限制限を明確化 |
| v1.1.5 | 2026-08-21 | Codex へ実装・修正を依頼する際に【レビュー粒度】ブロック（ループは「1ページ / 1機能」単位）を必ず含める旨を追記。codex-prompt-guideline.md への絶対ルール新設に追従。関連スキル表へ impl-review-loop を追加 |
| v1.1.4 | 2026-08-19 | Codex へのプロンプトに【スコープ】ブロック（ゴール外の作業禁止・着手前の目的/代償/停止条件の自己確認3点）を必ず含める絶対ルールを codex-prompt-guideline.md に新設したのに伴い、本ファイル・reference.md §5 へ言及を追記 |
| v1.1.3 | 2026-08-19 | Codex へのプロンプトに【モデル運用】ブロック（監督=GPT-6-Astra ultra（自動委託）/ 明示起動はモデル+effort セット指定 / 大問題時のみ GPT-6-Astra max を個別起動）を必ず含める絶対ルールを codex-prompt-guideline.md に新設したのに伴い、本ファイル・reference.md §5・ai-cli-execution-policy.md へ言及と正本リンクを追記 |
| v1.1.2 | 2026-08-17 | `agy --print-timeout` の値を `900` から `15m` へ修正（単位なしの `900` は EXIT=2 でオプション不正となり Antigravity 視点が空出力で失敗していた。2026-08-17 実測で確定） |
| v1.1.1 | 2026-08-16 | `.claude/docs/ai-cli-execution-policy.md` 未更新（`claude -p` が対象外のまま）に伴う reference.md §1 の引用元不一致を修正。policy.md §1 が「ツールの一般的な強み・CLI起動コマンド」のみを扱い、レビュー観点の割り当ては review-matrix.md が正本である旨を明記する形に揃え、reference.md §1 の要約もその区分に合わせて書き換えた |
| v1.1.0 | 2026-08-16 | Claude Code（`claude -p`）を対象ツールに追加（従来は Codex/Antigravity のみ）。実測で `claude -p` がネストセッションで OAuth 再認証を要求され失敗するケースを確認し、判定方法と Tier 3 フォールバック手順を reference.md §4/§4.5 に新設。`--allowedTools`（許可リスト）と `--tools`（利用可能ツールの選択）の違いを明記。`codex exec` の trusted directory 制約を追記（§5 Step 0.5）。Codex 利用制限到達時の実測例（復帰日時つき）を追記。`agy` headless の権限モデルを訂正（ファイル読み取りも auto-deny されうると判明。対処を「パス列挙」から「内容をプロンプトへ直接埋め込む」へ修正）。`agy --print-timeout`（既定5分・15分で成功した実績）と `--output-format`（text/json/stream-json）の詳細を追記 |
| v1.0.0 | 2026-07-30 | docs/ai-cli-execution-policy.md の実行手順をスキル化（配置ポリシー「手順書は Skill へ」準拠）。手順全文は reference.md が正本 |
