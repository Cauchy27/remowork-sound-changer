---
type: Reference
title: 外部AIツール実行ポリシー（CLI 優先・3層モデル）
description: Claude Code（claude -p）/ Codex / Antigravity を呼ぶ経路の優先順位（CLI > MCP > 親セッション上の別視点）、各ツールの強みと担当領域、CLI 未設定時のセットアップ案内、検証済みコマンド仕様
tags: [claude-code, codex, antigravity, cli, mcp, review, policy, fallback]
timestamp: 2026-08-02T00:00:00Z
---

# 外部AIツール実行ポリシー（CLI 優先・3層モデル）

Claude Code（`claude -p`。親セッションとは別プロセスで起動する。親が Claude Code ならネスト起動）/ Codex / Antigravity という**3視点**を呼ぶ際の経路と担当領域を定める。親セッション（オーケストレーター）は Claude Code・Codex・Antigravity のいずれでもよく、手順の読み替えは [ai-cli-execution/reference.md](../skills/ai-cli-execution/reference.md)「実行役ごとの読み替え」節に従う。**Claude Code 自身も対象に含む**（別プロセスとして起動する `claude -p` を、Codex/Antigravity と同格の視点として扱う）。
プロンプトの本文・適用層の理由は [Codex プロンプト設計ガイドライン](codex-prompt-guideline.md) を正本とする。Codexへの各依頼は、冒頭のゴール文直後に正本の【モデル運用】【スコープ】を全文展開し、送信本文で存在を確認する。実装・修正依頼には【レビュー粒度】も続ける（レビュー専用依頼には入れない）。CLI・非Bash経路とも同ガイドラインの展開・確認手順に従い、参照を示すだけで済ませない。

**本ファイルが方針（対象ツールと担当領域・経路の優先順位）の正本。実行手順の正本は [ai-cli-execution スキルの reference.md](../skills/ai-cli-execution/reference.md)。**

---

## 1. 対象ツールと担当領域

**同じ「別視点」でも強みが違う。** 本節が扱うのはツールの一般的な強み（経路選択・ルーティングの判断材料）であり、レビュー文脈での観点割り当て（誰が観点1〜9のどれを主担当するか）は `.claude/docs/review-matrix.md`「第1層: 視点」の交差表が正本である（**本節では観点番号による割り当てを再掲しない**）。

| ツール | CLI | 強み |
|--------|-----|------|
| **Claude Code** | `claude -p`（別プロセスとして独立実行。親が Claude Code ならネスト起動） | 大コンテキスト推論、プロジェクト固有規約の理解、Agent Teams 並列実行 |
| **Codex**（GPT-6 系） | `codex exec` | 実行・デバッグ・長期タスクの持続性。指摘が具体的で実行可能。ゴールへの執着が強く、中途半端な結論で止まらない |
| **Antigravity**（`agy`。マルチモデル基盤） | `agy --model gemini-4-argon-high` | **Gemini 系指定時**、視覚・空間推論とデザインに強い（下記の根拠は Gemini 3 系での評価）。2D UI/UX とグラフィカルプログラミングの理解が native。レビューで指定するモデルは 2026-10-26 にオーナー指定で `gemini-3.8-flash-high` から `gemini-4-argon-high` へ変更 |

### 観点の割り当て指針

- **実装・仕様・セキュリティのレビュー** → Codex を主、Antigravity を補
- **画面・デザイン・ドキュメントの構造や見通し** → Antigravity を主、Codex を補
- **両方が同じ問題を指摘した場合** → 信頼度が上がる。片方だけの指摘は事実照合（`code-review-fact-check`）へ回す
- ツールの強みと無関係な観点を割り当てない（Antigravity に SQL インジェクション検査だけをやらせる等）
- 観点番号（1〜9）での具体的な割り当ては `review-matrix.md` の交差表に従う。本節の指針はツール選定の一般則であり、観点番号による割り当てを本節で独自に定義しない

> 根拠: Codex は Artificial Analysis Coding Agent Index で Codex harness 首位、長期実行・ツール使用・エージェント制御が native。Gemini 3 系は視覚・空間推論ベンチマークとウェブサイトデザイン評価で首位。
>
> ⚠️ **`agy` は Gemini 専用ではない**（Claude・GPT-OSS も選べる）。既定モデルは agy の更新で変わる（実測 agy 1.4.2・2026-10-19 で Gemini 4 Argon (Medium)）ため、`--model` で指定モデルに固定することが必須。詳細は [ai-cli-execution スキルの reference.md](../skills/ai-cli-execution/reference.md) §6。

---

## 2. 経路の優先順位（全ツール共通）

| Tier | 手段 | 使う条件 |
|------|------|----------|
| **1** | **各ツールの CLI**（`claude -p` / `codex exec` / `agy -p`） | **既定**。PATH にあり認証済みなら必ずこちら |
| 2 | MCP（`mcp__codex__codex` 等。ツール名は Claude Code での名前で、他の実行役は「実行役ごとの読み替え」節） | CLI が使えない場合のみ。**Codex のみ対応・タスク分割必須** |
| 3 | 親セッション上の別視点サブエージェント（ペルソナ定義 `.claude/agents/llm-personas/` を読ませる）、または親自身が同一セッションで直接実施 | 実ツールが使えない場合の代替 |

※ **Antigravity と Claude Code は MCP 経路（Tier 2）を持たない。** CLI 不可時はどちらも Tier 2 を飛ばして直接 Tier 3（親セッション上の別視点、または親自身が同一セッションで直接実施）へ移る。

**CLI を飛ばして MCP・親セッション上の代替を選ぶことは禁止。** Tier を下げるたびに理由を成果物へ記録する。

**有料 API（従量課金）へ接続しうる、または判定できないときは、CLI を呼ばずに止めてオペレーターへ確認する**（下位 Tier への自動フォールバックより優先する。利用上限に達したときも有料へ切り替えない。判定は [ai-cli-execution/reference.md](../skills/ai-cli-execution/reference.md) §3「有料 API への接続確認」。2026-10-26 オーナー指示）。

Claude の独立 CLI は要求モデルを引数で明示し、親内サブエージェントは（親が Claude Code の場合）呼出指定・登録定義・環境既定を含むモデル解決順（正本はテンプレートリポジトリの agent-model-tuning.md。配布対象外）で確認する。`CLAUDE_CODE_SUBAGENT_MODEL` が未指定時の既定に関与するため、Tier 3 の視点名をモデルの証拠とせず、[独立性の申告](review-matrix.md) に要求モデル・実行モデル・根拠・起動経路を残す。

### CLI を最優先する理由

| 観点 | CLI | MCP |
|------|-----|-----|
| タイムアウト | 実行役側で制御可能。長時間タスクを1発で投げられる（Claude Code の Bash は前面実行が既定2分・上限10分のため、視点起動は背景実行にする。ai-cli-execution/reference.md §3「長時間の CLI 実行」） | 1リクエスト数分で MCP タイムアウト。**タスク分割が必須** |
| 結果の回収 | `-o FILE` で最終メッセージだけをファイル取得 | タイムアウトするとファイル書き出しも消える |
| コンテキスト | 出力をファイルへ逃がせるためメインを圧迫しない（実測: 1レビューの生ログは数百KB規模） | 応答が丸ごとコンテキストに載る |
| レビュー機能 | `codex exec review` のネイティブ差分レビューが使える | 相当機能なし |
| 権限制御 | `-s read-only` でサンドボックス指定。`-s` はシェルを縛るだけで MCP のツールには効かないため、視点のレビューでは `--ignore-user-config` で利用者の設定の MCP も外す（ai-cli-execution/reference.md §5 Step 2） | MCP サーバー設定に依存 |

---

## Claude Code MCP経路とcommit検査

本節は commit 検査 hook（PreToolUse の pre-commit-check）を導入した場合の構成（`.claude/settings.json` の PreToolUse 登録と commit 検査）の説明である。hook の導入は任意（2026-10-19 オーナー判断）で、本体リポジトリは登録していない。導入している拠点では、その拠点の `.claude/settings.json` と hook スクリプトを正とし、ここに書いた matcher・内部 deadline・証跡契約がそのまま当たるとは限らない。

`claude mcp serve` はClaude Codeのツールを公開するサーバーであり、レビュー用の独立Claude実行を置き換えるTier 2ではない。個々の呼出確認はクライアント側の責任になる。[公式MCP仕様](https://code.claude.com/docs/en/mcp#use-claude-code-as-an-mcp-server)

本体の `mcp__claude-code__*` 包括allowは、2026-09-06に `claude mcp serve` の `tools/list`（server `claude/tengu` 2.1.261）で確認した `mcp__claude-code__Read` だけへ限定した。この公開一覧にGlob/Grepは無かったため追加していない。書込・Bash・その他のツールは包括許可から外し、既存のdeny/askと通常の権限判定に戻す。将来の追加はその環境の公開一覧と用途を確認して判断する。

PreToolUseのmatcherは `Bash|mcp__claude-code__.*`。MCP Bashの明示的なcommitは、外側のhookからサーバーのcwd/indexを確定できないため阻止し、native Bashの `git -C <対象repo> commit` 単独実行へ移す。非commitのMCP操作を一律denyにはしない。MCP内部の独自検査の有無は未確認であり、この変更は実データ流出の発生を前提にしない。

commitはstageと分け、検査対象を確定したindexに固定する。成功・対象外はhookから追加のallowを返さず通常permissionsへ戻し、違反・入力不正・検証器異常・内部期限超過はexit 2で阻止する。設定のtimeout到達では判定が失われるため、180秒の外側timeoutより短い150秒の内部deadlineを設ける。[公式hook仕様](https://code.claude.com/docs/en/hooks#timeouts)

対象版と必須内部構造レビュー結果の対応は skill-creation-flow.md の証跡契約に従う。任意のスクリプト内・外部CLIのcommitや、hook終了後の別プロセスによるindex変更まで保証するものではない。配布時の設定・helper同梱は、存在する配布テンプレートのREADMEを確認する。

---

## 実行手順（移管済み）

実行手順（実行前準備・CLI セットアップ案内・Tier 1/2/3 の詳細・利用制限時の対応・禁止事項）は
**[ai-cli-execution スキル](../skills/ai-cli-execution/SKILL.md)** へ移管した
（配置ポリシー「手順書は Skill へ」準拠。2026-07-30）。

本ドキュメントは**方針**（担当領域・経路の優先順位）のみを扱う。役割分担は冒頭を参照。
