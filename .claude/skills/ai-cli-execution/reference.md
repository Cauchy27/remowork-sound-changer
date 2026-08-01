---
type: Reference
title: 外部AIツール実行ポリシー（CLI 優先・3層モデル）
description: Codex / Antigravity を呼ぶ経路の優先順位（CLI > MCP > Claude 別視点）、各ツールの強みと担当領域、CLI 未設定時のセットアップ案内、検証済みコマンド仕様
tags: [codex, antigravity, cli, mcp, review, policy, fallback]
timestamp: 2026-08-02T00:00:00Z
---

# 外部AIツール実行手順（詳細リファレンス）

> 発動導線と実行フローの要約は [SKILL.md](SKILL.md)。本ファイルが手順の正本。

Claude Code から**別視点のAIツール**（Codex / Antigravity）を呼ぶ際の経路と担当領域を定める。
プロンプトの書き方は [Codex プロンプト設計ガイドライン](../../docs/codex-prompt-guideline.md) を参照（本ポリシーは経路と役割、あちらは中身）。

---

## 1. 対象ツールと担当領域（要約）

対象ツールと担当領域の正本は [ai-cli-execution-policy.md](../../docs/ai-cli-execution-policy.md) §1。
Codex（`codex exec`）は正確性・バグ・セキュリティ・実行可能性、Antigravity（`agy --model gemini-3.1-pro-high`）は UI・UX・視覚階層・デザイン整合を主担当する。

---

## 2. 経路の優先順位（要約）

経路の優先順位の正本は [ai-cli-execution-policy.md](../../docs/ai-cli-execution-policy.md) §2。
Tier 1 = 各ツールの CLI（`codex exec` / `agy -p`、既定）、Tier 2 = MCP（`mcp__codex__codex` 等。**Codex のみ**）、Tier 3 = Claude Code の別視点サブエージェント。
**Antigravity は MCP 経路を持たないため、CLI 不可時は Tier 2 を飛ばして直接 Tier 3 へ移る。**

---

## 3. 共通の実行前準備

出力先ディレクトリを**必ず先に作る**。CLI は親ディレクトリを自動作成しない。

```bash
mkdir -p .tmp/ai-review && git check-ignore -q .tmp/ai-review && echo "IGNORED_OK"
```

`IGNORED_OK` が出ない場合は Git 管理外の一時ディレクトリ（`mktemp -d`）を使う。

---

## 4. CLI が未設定の場合（必須案内）

**勝手に Tier を下げる前に、必ず次を提示すること。** 提示せずにフォールバックするのは違反。

### Codex CLI

````markdown
Codex CLI が未設定のため、レビューの第1経路が使えません。

【現状】`command -v codex`: {結果}

【セットアップ手順】

```bash
npm install -g @openai/codex
```

```bash
codex login
```

`codex --version` でバージョンが出れば完了です。

【このまま進める場合】
Codex MCP（Tier 2）へフォールバックします。MCP はタイムアウトのためタスク分割が必要で、所要時間が伸びます。
````

### Antigravity CLI

````markdown
Antigravity CLI（agy）が未設定のため、デザイン・UX 視点の第1経路が使えません。

【現状】`command -v agy`: {結果}

【セットアップ手順】

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

`~/.local/bin/agy` に入ります。**インストーラがログインシェルの設定ファイルへ PATH を自動追記する**ため、手動追記は不要です。設定を反映するには新しいシェルを開いてください。

```bash
exec $SHELL -l
```

> ⚠️ `source ~/.zshrc` のようにシェル固有ファイルを直接読むと、ログインシェルが異なる場合に `autoload: command not found` 等で失敗します。ログインシェルは `dscl . -read ~/ UserShell` で確認できます。

続けて対話セッションで1回だけ認証します（ブラウザでの Google OAuth 操作が必要）。

```bash
agy
```

`agy --version` が通れば完了です。以後は headless 実行できます。

【このまま進める場合】
Claude Code の `antigravity` ペルソナ（Tier 3）で代替します。実 Gemini ではないため、
デザイン・空間把握の独立性は低下します。
````

**案内を出したら作業を止めず、下位 Tier に落として継続する。判断を仰いで停止しない。**
そのうえで **成果物に「{ツール} CLI 未設定のため Tier {n} で実施」と明記する**。

---

## 5. Tier 1: Codex CLI

### Step 0: 利用可否の判定

```bash
command -v codex && codex --version
```

見つからない／バージョンが出ない → **セットアップ手順を案内**（§4）してから Tier 2 へ。

### Step 1: 疎通確認

```bash
codex exec -s read-only -o .tmp/ai-review/probe.md "ゴールは PONG とだけ返すこと。" < /dev/null > .tmp/ai-review/probe.log 2>&1; echo "EXIT=$?"
```

`EXIT=0` かつ出力ファイルに `PONG` → 疎通OK。失敗時は `probe.log` に理由が残る。

### Step 2: 観点付きレビュー（標準形）

```bash
codex exec -s read-only -o .tmp/ai-review/{名前}.md "{4要素プロンプト}" < /dev/null > .tmp/ai-review/{名前}.log 2>&1; echo "EXIT=$?"
```

| 要素 | 理由 |
|------|------|
| `-s read-only` | レビュー・調査は読み取りのみ。書き込みが必要な場合だけ `workspace-write` を明示的に選ぶ |
| `-o {ファイル}` | **正常終了時に最終メッセージだけ**を保存する。途中経過は残らない |
| `< /dev/null` | 付けないと stdin を待って停止する |
| `> {ログ} 2>&1` | 進捗ログを**捨てずに別ファイルへ**。メインコンテキストを汚さず、失敗理由も残る |
| `echo "EXIT=$?"` | 成否判定。出力ファイルの存在・非空とあわせて確認する |

### Step 3: ネイティブ差分レビュー

```bash
codex exec -s read-only review -o .tmp/ai-review/diff-review.md --base main < /dev/null > .tmp/ai-review/diff-review.log 2>&1; echo "EXIT=$?"
codex exec -s read-only review -o .tmp/ai-review/diff-review.md --uncommitted < /dev/null > .tmp/ai-review/diff-review.log 2>&1; echo "EXIT=$?"
codex exec -s read-only review -o .tmp/ai-review/diff-review.md --commit {SHA} < /dev/null > .tmp/ai-review/diff-review.log 2>&1; echo "EXIT=$?"
```

> ⚠️ **`review` は対象指定オプションと位置引数プロンプトを併用できない。** 実測で `exit 2` になる。
>
> ```
> $ codex exec review --uncommitted "セキュリティ観点で見て"
> error: the argument '--uncommitted' cannot be used with '[PROMPT]'
> ```
>
> **観点を指定したいレビューは `review` ではなく Step 2 の `codex exec` を使う**（プロンプト内で対象差分を指示する）。

### Step 4: 結果の回収と統合

- `EXIT`、出力ファイルの**存在**と**非空**の3点を確認してから読む
- 出力ファイルが無い／空なら、ログファイルの末尾を見て失敗理由を特定する
- CLI ではタイムアウト由来の**強制分割は不要**。観点ごとに独立した結論が欲しい場合のみ分割・並列実行する

---

## 6. Tier 1: Antigravity CLI（agy）

### Step 0: 利用可否の判定

```bash
command -v agy && agy --version
```

見つからない → **セットアップ手順を案内**（§4）してから Tier 3 へ（Antigravity は MCP 経路を持たないため Tier 2 を飛ばす）。

### 🔴 Step 1: モデルを必ず明示する

**`agy` は Gemini 専用ではない。複数モデルを切り替えられる実行基盤である。**
実測（v1.1.8）の `agy models` 出力:

```
gemini-3.6-flash-high / -medium / -low
gemini-3.5-flash-high / -medium / -low
gemini-3.1-pro-high / -low
claude-sonnet-4-6
claude-opus-4-6-thinking
gpt-oss-120b-medium
```

**既定は `Gemini 3.6 Flash`**（Pro ではない）。モデルを指定しないと、
§1 で期待した「視覚・空間推論とデザインの強み」は得られず、設定次第では Claude が選ばれて
**独立視点そのものが失われる**。

| 用途 | 指定するモデル |
|------|---------------|
| デザイン・UX・空間把握のレビュー | `--model gemini-3.1-pro-high` |
| 軽量な確認・疎通 | 既定（Flash）で可 |

**Claude 系モデルを選んだ場合は「独立視点」にならない。** 成果物には実際に使ったモデル名を必ず記録する。

### Step 2: 非対話実行の標準形

```bash
agy --mode plan --model gemini-3.1-pro-high -p "{4要素プロンプト}" --output-format json > .tmp/ai-review/{名前}.json 2> .tmp/ai-review/{名前}.log; echo "EXIT=$?"
```

| 要素 | 理由 |
|------|------|
| `--mode plan` | **レビューでは必須。** 既定モードはワークスペース内の書き込みが許可されており、レビューのつもりが作業ツリーを変更しうる（`accept-edits` / `plan` の2値） |
| `--model` | 上表のとおり明示する。省略すると Flash になる |
| `-p` | 非対話（headless）実行。1プロンプトを実行して終了する |
| `--output-format json` | 実測で `conversation_id` / `status` / `response` / `duration_seconds` / `num_turns` / `usage` を返す。`text` は応答本文のみ |
| `> {ファイル}` | 応答は **stdout**、診断は **stderr**。リダイレクトで結果だけを回収する |
| `echo "EXIT=$?"` | 成功は `0`、失敗は非ゼロ（`stderr` と JSON の `error` に詳細） |

`--print-timeout` の既定は **5分**。長いレビューでは明示的に延ばす。

レビュー後は、書き換えが起きていないことを `git status --porcelain` で確認する。

- 継続実行は `--continue`（直近の会話）または `--conversation {id}`。**`--continue` は並列実行中だと別の会話を再開しうる**ため、並列時は `--output-format json` が返す `conversation_id` を控えて `--conversation` で明示指定する
- **`--dangerously-skip-permissions` はレビュー用途で使わない**

#### ⚠️ headless の権限モデル（実測。最も踏みやすい罠）

**`command`（シェル実行）権限を要するツールは headless では auto-deny され、`EXIT=0` のまま出力が空になる。**
成功と区別がつかないため、**出力の非空チェックを必ず行う**こと。

```
jetski: no output produced — a tool required the "command" permission that headless mode
cannot prompt for, so it was auto-denied.
```

対処は次の優先順。

| # | 対処 | 内容 |
|---|------|------|
| 1（推奨） | **プロンプトからシェル実行を排除する** | `git diff` を実行させず、**対象ファイルのパスを明示列挙**して渡す。ワークスペース内のファイル読み取りは auto-allow なので通る |
| 2 | 権限を事前付与 | `~/.gemini/antigravity-cli/settings.json` の `permissions.allow` に `command(<target>)` ルールを追加する |
| 3 | 使わない | `--dangerously-skip-permissions` は全ツールを自動承認するため、レビュー用途では選ばない |

あわせて、プロンプト本文に **「シェルコマンドは実行しないこと。ファイルの読み取りだけで判定する」** と明記する。

### Step 3: 疎通確認

```bash
agy -p "ゴールは PONG とだけ返すこと。" --output-format text > .tmp/ai-review/agy-probe.md 2> .tmp/ai-review/agy-probe.log; echo "EXIT=$?"
```

`EXIT=0` かつ出力ファイルが `PONG` のみ → 疎通OK（実測で stderr は空になる）。

**`EXIT=0` だけで成功と判定しないこと。** 権限 auto-deny 時は `EXIT=0` かつ出力が空になる（後述）。出力ファイルの**非空**を必ず確認する。

### Step 4: 認証の前提

**headless はキャッシュ済み認証情報を使う。未認証の非対話環境ではハングせずエラー終了する。**
先に対話セッション（`agy` を素で起動）で1回 Google OAuth 認証を済ませておく必要がある。

---

## 6.5 利用制限（usage limit）に達した場合

**⚠️ Tier を下げても回避できない失敗モード。** CLI と MCP は同一アカウントの利用枠を共有するため、**同時に制限される**（実測）。

| 経路 | 症状 |
|------|------|
| CLI | `EXIT=1` かつ**出力ファイルが生成されない**。ログに `You've hit your usage limit ... try again at {日時}` |
| MCP | 同一メッセージでエラー。**CLI が制限中なら MCP も必ず失敗する** |

対処:

1. **Tier 2 へ落とさない**（同じ枠なので無駄）
2. **別ツールの視点で代替する** — Codex が制限中なら Antigravity（`agy`）は別枠なので使える。逆も同じ
3. それも不可なら Tier 3（Claude 別視点）へ落とす
4. **復帰予定時刻を成果物に記録する**（例: 「Codex は利用制限のため 2026-08-05 15:00 まで利用不可」）

```
{ツール}: 利用制限に到達（復帰予定 {日時}）。同一アカウントのため MCP 経路も利用不可。
{代替手段} で実施したため、当該観点の独立性は低下している。
```

---

## 7. Tier 2: MCP（Codex のみ）

CLI が使えない場合のみ。**タスク分割が必須**である点が CLI との最大の違い。

- 1リクエスト = 1ファイル / 1観点 / 主張3〜5件
- 疎通確認で threadId を取得し、`mcp__codex__codex-reply` で1件ずつ順次投入する
- 結果はテキストで返させる（タイムアウトするとファイル出力も消えるため）
- 同一単位が2回タイムアウトしたら、その単位は Tier 3 へ回す

詳細は `.claude/skills/code-review/SKILL.md` の「Codex 実行」セクションを参照。

---

## 8. Tier 3: Claude Code の別視点（最終手段）

実ツールが使えない場合の代替。

| 代替手段 | 用途 |
|---------|------|
| `.claude/agents/llm-personas/codex.md` | Codex 視点（実務・批判レビュー）を Claude 上で再現 |
| `.claude/agents/llm-personas/antigravity.md` | Antigravity 視点（デザイン・UX・空間把握）を Claude 上で再現 |
| `universal-security-reviewer`（Claude Code 組み込み） | セキュリティ観点 |
| `universal-performance-analyzer`（Claude Code 組み込み） | パフォーマンス観点 |

**Tier 3 は実ツールの等価物ではない。** 同一モデルによる自己レビューであり独立性が下がる。成果物には次を必ず記載する。

```
{ツール}: 利用不可（CLI 未設定 / MCP 未接続）。Claude Code の別視点で代替したため、独立性は低下している。
```

---

## 9. 禁止事項

- CLI が使えるのに MCP・Claude 代替を選ぶ
- CLI 未設定を検出しながら、セットアップ手順を案内せず黙って下位 Tier へ落ちる
- Tier を下げた事実を成果物に書かない
- 利用制限に達した CLI に対して MCP へフォールバックする（同一枠なので必ず失敗する）
- ツールの強みと無関係な観点を割り当てる（§1 の担当領域を無視する）
- 出力先ディレクトリを作らずに `-o` を指定する（書き込みに失敗し結果を失う）
- CLI の生の標準出力をそのままメインコンテキストへ流す
- `agy` の結果を `EXIT=0` だけで成功と判定する（権限 auto-deny 時は EXIT=0 かつ出力が空になる）
- `agy` へ渡すプロンプトでシェルコマンドの実行を求める（headless では auto-deny される）
- `codex exec review` に対象指定と観点プロンプトを併用する（`exit 2` になる）
- `review` サブコマンドで `-s read-only` を省略する（**review も設定済み sandbox を継承する**ため、workspace-write 環境ではワークツリーを書き換えられる）
- レビュー用途で `-s danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` / `--dangerously-skip-permissions` を使う

---

## 10. 適用箇所

| 適用元 | 内容 |
|--------|------|
| `code-review` スキル | レビュー経路と観点の割り当て |
| `code-review/agents/codex-reviewer.md` | Codex 実行手順そのもの |
| `agent-review` スキル | 独立レビューの経路選択 |
| `development-orchestration` スキル | 複数視点検証でのツール呼び出し |
| `.claude/agents/llm-personas/*.md` | Tier 3 代替時のペルソナ定義 |
| その他 | 外部AIツールを呼ぶ全ての場面 |
