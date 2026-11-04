---
type: Reference
title: 外部AIツール実行ポリシー（CLI 優先・3層モデル）
description: Claude Code（claude -p）/ Codex / Antigravity を呼ぶ経路の優先順位（CLI > MCP > 親セッション上の別視点）、各ツールの強みと担当領域、CLI 未設定・OAuth 失効時のセットアップ／フォールバック案内、検証済みコマンド仕様
tags: [claude-code, codex, antigravity, cli, mcp, review, policy, fallback]
timestamp: 2026-08-02T00:00:00Z
---

# 外部AIツール実行手順（詳細リファレンス）

> 発動導線と実行フローの要約は [SKILL.md](SKILL.md)。本ファイルが手順の正本。
> レビュー文脈での視点定義（誰が見るか）は [review-matrix.md](../../docs/review-matrix.md) が正本。本ファイルは3視点（Claude Code / Codex / Antigravity）を実CLIとして呼ぶ際の経路・担当領域・検証済みコマンド仕様を扱う。

親セッション（オーケストレーター。Claude Code・Codex・Antigravity のいずれでもよい）から、**3視点**（Claude Code / Codex / Antigravity）を独立プロセスとして呼ぶ際の経路と担当領域を定める。手順の例は Claude Code が実行役の場合の書き方を基本にしており、他の実行役は「[実行役ごとの読み替え](#実行役ごとの読み替え)」節で読み替える。
**Claude Code 自身も対象に含む。** review-matrix.md の第1層が定める3視点のうち、Claude Code 視点はネストした `claude -p` を別プロセスとして起動することで実現する（親セッションのペルソナ代替ではない）。
プロンプトの書き方は [Codex プロンプト設計ガイドライン](../../docs/codex-prompt-guideline.md) を参照（本ポリシーは経路と役割、あちらは中身）。

---

## 1. 対象ツールと担当領域（要約）

ツールの一般的な強み・CLI 起動コマンドの正本は [ai-cli-execution-policy.md](../../docs/ai-cli-execution-policy.md) §1。
Claude Code（`claude -p`）は大コンテキスト推論・プロジェクト固有規約の理解・Agent Teams 並列実行、Codex（`codex exec`）は実行・デバッグ・長期タスクの持続性、Antigravity（`agy --model gemini-4-argon-high`）は視覚・空間推論とデザインを一般的な強みとする。
**レビュー文脈での観点割り当て（誰が観点1〜9のどれを主担当するか）の正本は [review-matrix.md](../../docs/review-matrix.md)「第1層: 視点」の交差表。** `ai-cli-execution-policy.md` §1 は観点番号による割り当てを再掲しない（住み分けは review-matrix.md「本ファイルと ai-cli-execution-policy.md の住み分け」節）。

---

## 2. 経路の優先順位（要約）

経路の優先順位の正本は [ai-cli-execution-policy.md](../../docs/ai-cli-execution-policy.md) §2。
Tier 1 = 各ツールの CLI（`claude -p` / `codex exec` / `agy -p`、既定）、Tier 2 = MCP（`mcp__codex__codex` 等。**Codex のみ**）、Tier 3 = 親セッション上の別視点サブエージェント（ペルソナ定義を読ませる）、または親自身が同一セッションで直接実施する（読み替えは「[実行役ごとの読み替え](#実行役ごとの読み替え)」節）。
**Antigravity と Claude Code は MCP 経路を持たないため、CLI 不可時は Tier 2 を飛ばして直接 Tier 3 へ移る。**

---

## 実行役ごとの読み替え

本書の手順例（`Task(...)`・`mcp__codex__*`・Bash の背景実行など）は、親セッション（オーケストレーター）が Claude Code の場合の書き方である。親セッションが Codex・Antigravity の場合は次の表で読み替える。視点の起動コマンド（`claude -p` / `codex exec` / `agy -p`）、出力の扱い、§3「有料 API への接続確認」は、どの実行役でも同じ。

| 項目 | Claude Code が実行役 | Codex が実行役 | Antigravity が実行役 |
|------|--------------------|---------------|--------------------|
| サブエージェント起動 | Agent（Task）ツール | 明示的なサブエージェント起動（モデルと reasoning effort をセットで指定する。[codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md)【モデル運用】） | `invoke_subagent`（`.claude/agents/*.md` の定義を読み込ませる） |
| Codex MCP（Tier 2） | `mcp__codex__codex` / `mcp__codex__codex-reply` | 各ツールの MCP 呼び出し機構 | MCP 呼び出しツールでサーバー `codex` を指定する |
| 長時間の CLI 実行（§3） | Bash の背景実行（`run_in_background`） | 各ツールの長時間実行の手段に従い、タイムアウトを十分に取る | 同左 |

実行役を問わない扱い:

| 場面 | 扱い |
|------|------|
| 自分自身と同じツールの視点 | 別プロセスの CLI（`claude -p` / `codex exec` / `agy -p`）で独立起動を優先する。不可なら親セッションで直接実施し、独立性の低下を成果物に明記する |
| Tier 3（他視点の代替） | 親セッション上で、ペルソナ定義（`.claude/agents/llm-personas/*.md`）を読ませたサブエージェント、または親自身が同一セッションで適用する。要求モデルは各ツールの指定方法で渡す（Codex はモデルと reasoning effort のセット） |
| 裁定（Round 2 等） | 実際の親セッションが行う |

---

## 3. 共通の実行前準備

出力先ディレクトリを**必ず先に作る**。CLI は親ディレクトリを自動作成しない。疎通確認（§4.5 Step 3・§5 Step 1・§6 Step 3）だけを先に行う場合も、`.tmp/ai-review/` へ書く前にこの準備を行う。

```bash
mkdir -p .tmp/ai-review || exit 1
if ! git check-ignore -q .tmp/; then   # 無視されていなければ、追跡対象を変えない .git/info/exclude に足す
  exclude=$(git rev-parse --git-path info/exclude) && mkdir -p "$(dirname "$exclude")" && printf '%s\n' '.tmp/' >> "$exclude"
fi
git check-ignore -q .tmp/ && echo "IGNORED_OK"
```

`git check-ignore -q .tmp/` が失敗したときは、`.git/info/exclude` に `.tmp/` を追記して進める（`.gitignore` を変えないので、追跡対象・コミット対象は変わらない）。それでも `IGNORED_OK` が出ない場合（Git 管理外のディレクトリ、`.gitignore` の否定パターンが優先される等）は Git 管理外の一時ディレクトリ（`mktemp -d`）を使う。

**結果・ログ・プロンプトのファイルは、実行ごとに `mktemp -d` で作るディレクトリ（`REVIEW_DIR`）へ置く。** 同じパスへ出力すると、並列の実行や同じ checkout の別セッションの結果で上書きされ、`EXIT` と出力の非空の確認では見抜けない（§6 Step 1 の専用ログと同じ理由）。本書の各節の標準形（§4.5・§5・§6 の Step 2、§5 Step 3）と、複数の視点を並列に起動するレビューの例（code-review の reference.md §1「準備」、internal-structure-review Step 2）は、どれもこの `REVIEW_DIR` の中へ出力する。各例は別の Bash 呼び出しで実行するため、下で表示された値を各例の先頭の `REVIEW_DIR="{…}"` に入れる。

```bash
REVIEW_DIR=$(mktemp -d .tmp/ai-review/run.XXXXXX) || exit 1; echo "REVIEW_DIR=$REVIEW_DIR"   # IGNORED_OK が出なかったときは REVIEW_DIR=$(mktemp -d)（Git 管理外）
```

疎通確認（§4.5 Step 3・§5 Step 1・§6 Step 3）の出力は、結果をレビューに使わないため `.tmp/ai-review/` 直下の固定名のままにしている。別の実行と重なって取り違えうるので、疎通 NG と読んだときは、認証切れ（§4。Claude Code の OAuth 失効を含む）に当たらない限り、Tier を下げる前に疎通確認だけを1回やり直す。認証切れに当たる場合はやり直さず、§4 の案内とフォールバックに従う（OAuth 失効で再試行を繰り返すのは §9 の禁止事項）。疎通 OK と取り違えた場合は、続く本実行の `EXIT` と非空の確認で失敗が表に出る。

**プロンプト本文はシェルの二重引用符の中へ直接書かない。** バッククォートや `$` がシェルに展開され、送信前に消えるか実行される。本文はファイルに書き（Write ツール等）、変数へ読み込んで `"$変数"` として渡す（変数の値は再展開されない）。Codex の標準形（§5 Step 2）はクォート付きヒアドキュメントで組み立てるため展開されない。

### 有料 API への接続確認

外部 CLI（`claude -p` / `codex exec` / `agy`）へ依頼を送る直前に（疎通確認を含む）、送り先の認証方式を確かめる。**従量課金の API に接続しうる、または判定できないときは、CLI を呼ばずに止め、オペレーターへ確認する**（続行・Tier 3 で代替・中止のどれにするか）。この停止は §4 の「止めずに下位 Tier で続行」より優先する（2026-10-26 オーナー指示）。

| CLI | 確かめるもの | 止める条件 |
|-----|-------------|-----------|
| Codex | `codex login status`、環境変数 | 出力が `Logged in using ChatGPT` 以外（API キー等）。または `OPENAI_API_KEY` / `CODEX_API_KEY` が設定済み |
| Claude Code | `claude auth status`、環境変数 | `authMethod` が `claude.ai` 以外、`apiProvider` が `firstParty` 以外（Bedrock / Vertex 等）。または `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` が設定済み |
| agy | 環境変数 | `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `GOOGLE_GENAI_USE_VERTEXAI` が設定済み。Google OAuth で認証済み（§6 Step 4）であることを前提とし、認証方式を確かめられないときも止める |

環境変数は値を表示せず、設定の有無だけを確かめる。`claude auth status` の出力にはメールアドレスが含まれるので、表示と記録には `authMethod` と `apiProvider` だけを写す。使う CLI の行だけを実行すればよい。

```bash
for v in OPENAI_API_KEY CODEX_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENAI_USE_VERTEXAI; do
  [ -n "$(printenv "$v")" ] && echo "STOP: $v が設定済み"
done
codex login status 2>&1 | grep -qx 'Logged in using ChatGPT' && echo "codex: ChatGPT" || echo "STOP: codex の認証方式が ChatGPT ではない、または確かめられない"
claude_auth=$(claude auth status 2>/dev/null)
printf '%s\n' "$claude_auth" | grep -E '"(authMethod|apiProvider)"'
printf '%s\n' "$claude_auth" | grep -qE '"authMethod": *"claude\.ai"' &&
  printf '%s\n' "$claude_auth" | grep -qE '"apiProvider": *"firstParty"' && echo "claude: claude.ai / firstParty" || echo "STOP: claude の認証方式が claude.ai / firstParty ではない、または確かめられない"
```

`STOP` が1行でも出たら、その CLI を呼ばない。止めた理由（変数名、`authMethod` / `apiProvider` の値。秘密の値・メールアドレスは書かない）を添えてオペレーターへ確認し、指示を受けるまで、その CLI を使う工程は進めない。確認の結果と選んだ経路は成果物に記録する。

**利用上限（usage limit）に達したときも、有料への切り替えはしない。** CLI が有料クレジットの購入や API キー（従量課金）への切り替えを提案しても受け入れない。その場合は従来どおり、定額の別ツールの視点か Tier 3 へ止めずに切り替えて続行し、成果物に明記する（§6.5）。先へ進む手段が従量課金の接続しか無いときだけ、止めてオペレーターへ確認する。

実測（2026-10-26）: `codex login status` は `Logged in using ChatGPT`、`claude auth status` は `authMethod: claude.ai` / `apiProvider: firstParty`、agy は Google OAuth（`oauth-personal`）。上表の環境変数はすべて未設定だった。

### 長時間の CLI 実行

**Claude Code が実行役のとき、Bash ツールの前面実行は既定2分・上限10分で打ち切られる。** `codex exec`（xhigh）・`agy -p`・`claude -p` の視点起動は、**Bash の背景実行（`run_in_background`）を標準**とし、完了通知を待ってから結果ファイルを読む（`EXIT`・出力の存在・非空の確認は §5 Step 4 と同じ）。前面で打ち切られた実行を「CLI 不通」と誤判定して Tier 3 に落とさない。

Codex / Antigravity が実行役のときは、各ツールの長時間実行の手段に従い、タイムアウトを十分に取る（「[実行役ごとの読み替え](#実行役ごとの読み替え)」節）。

---

## 4. CLI が未設定・利用不可の場合（必須案内）

**勝手に Tier を下げる前に、必ず次を提示すること。** 提示せずにフォールバックするのは違反。

### Claude Code CLI（`claude -p`）が未設定の場合

```bash
command -v claude && claude --version
```

未検出の場合は Claude Code CLI 自体の導入手順を案内する（通常は npm 経由でインストール済みのはず。未導入は稀）。

### Claude Code CLI が OAuth 認証切れの場合（実測。ネストセッション特有の罠）

**`claude` コマンド自体は見つかるが、ネストされた非対話セッション内で OAuth トークンが失効しているために失敗するケースがある。** これは「未設定」ではなく「認証切れ」なので、Step 0 の疎通確認だけでは検出できない。

【判定方法】

```bash
# 設定例: CLAUDE_REVIEW_MODEL=claude-opus-5-5（要求モデルの識別子。§4.5 Step 2）
: "${CLAUDE_REVIEW_MODEL:?要求モデルの識別子を設定する}"
claude -p --model "$CLAUDE_REVIEW_MODEL" --permission-mode plan --allowedTools "" --output-format text \
  "ゴールは PONG とだけ返すこと。" < /dev/null > /tmp/claude-auth-probe.md 2> /tmp/claude-auth-probe.log
echo "EXIT=$?"
```

`EXIT` が非ゼロ、かつ出力ファイルが空、かつログに認証・ログイン・OAuth 関連の文言が含まれる場合、ネストセッションでの再認証要求と判断する。ブラウザでの対話ログインが必要な認証フローは、非対話（`< /dev/null`）のネストセッション内では完了できない。`CLAUDE_REVIEW_MODEL` が未設定で `:?` の行で止まった場合（`EXIT=` の行が出ず、エラー出力に「要求モデルの識別子を設定する」が出る）は認証切れではない。

【このまま進める場合】
**再試行を繰り返さず、直ちに Tier 3 へフォールバックする**（親セッションが Claude Code なら、親が Claude Code 視点として直接レビューを実施する。それ以外の親は「[実行役ごとの読み替え](#実行役ごとの読み替え)」節）。 Claude Code は MCP 経路（Tier 2）を持たないため、Tier 1 が使えなければ Tier 3 のみが選択肢になる。Tier 3 は「同一セッション内のペルソナによる自己レビュー」に相当するため、成果物冒頭に独立性低下を明記すること（[review-matrix.md](../../docs/review-matrix.md)「独立性の申告」）。

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
親セッション上の `antigravity` ペルソナ（Tier 3）で代替します。実 Antigravity CLI（別プロセス）ではないため、
デザイン・空間把握の独立性は低下します。
````

**案内を出したら作業を止めず、下位 Tier に落として継続する。判断を仰いで停止しない。**
そのうえで **成果物に「{ツール} CLI 未設定のため Tier {n} で実施」と明記する**。
例外として、§3「有料 API への接続確認」で止める条件に当たった場合は、止めてオペレーターへ確認する（こちらを優先する）。利用上限に達した場合（§6.5）は、有料へ切り替えずに定額の別ツールの視点か Tier 3 で続行し、先へ進む手段が従量課金の接続しか無いときだけ止めてオペレーターへ確認する。

---

## 4.5 Tier 1: Claude Code CLI（`claude -p`）

内部構造レビュー（`internal-structure-review`）等が Claude Code 視点を独立プロセスとして起動する際の標準手順。**発動元セッションが Claude Code であっても、ここでの `claude -p` は別プロセスであり、親セッションの文脈を持たない**（[review-matrix.md](../../docs/review-matrix.md)「視点を実CLIで実行する理由」）。

### Step 0: 利用可否の判定

```bash
command -v claude && claude --version
```

見つからない、または OAuth 認証切れ（§4「Claude Code CLI が OAuth 認証切れの場合」参照）→ **Tier 2 を持たないため直接 Tier 3 へ**。
見つかったら、起動前に §3「有料 API への接続確認」を行う。

### 🔴 Step 1: `--allowedTools` と `--tools` の違い（要区別）

**両方とも実在するフラグだが、意味がまったく異なる。混同すると意図せず全ツールが使える／逆に必要なツールまで塞がる。** 読み取り専用レビューでは両方を同じ値で付ける。

| フラグ | 意味 | 読み取り専用レビューでの選択 |
|--------|------|---------------------------|
| `--allowedTools`（`--allowed-tools`） | 指定したツールを**確認プロンプトなしで自動承認する許可リスト**。リストにないツールは `--permission-mode` の既定挙動（プロンプト／拒否）に従う。**利用可能なツールの集合は絞らない**（実測 2026-10-26: `--permission-mode plan` と `--allowedTools "Read,Grep,Glob"` だけで起動した internal-structure-review の視点セッションで、読み取りの Bash が計10回実行され、視点は Agent も使えると申告した） | **○ 採用**。`Read,Grep,Glob` を確認なしで通す |
| `--tools` | 起動時に**利用可能なツールの集合そのものを選択する**（ビルトインからの絞り込み）。空文字列で全ツール無効化、`"default"` で全ツール有効化も可能。MCP のツールは対象外 | **○ 併用**。`Read,Grep,Glob` を指定し、Bash・Agent・Write 等を存在させない（実測 2026-10-26・claude 2.1.296: `--tools "Read,Grep,Glob"` を足すと、ビルトインは Glob・Grep・Read だけになり、Bash・Agent は出なかった。MCP のツールは残った）。単独では確認プロンプトの自動承認にはならない |

**読み取り専用レビューには `--tools` と `--allowedTools` を同じ値で併用する。** `--allowedTools` だけでは Bash・Agent 等も使え、`--tools` だけでは非対話実行時に権限プロンプトで止まりうる。どちらも MCP のツールと利用者の設定ファイル（hook を含む）は外さないので、視点の標準形（Step 2）ではさらに `--restricted --strict-mcp-config` を付ける。

### Step 2: 非対話実行の標準形

要求モデルはユーザー指定とレビューの要件から決め、利用可能な識別子を確認して `CLAUDE_REVIEW_MODEL` に設定する（例: `CLAUDE_REVIEW_MODEL=claude-opus-5-5`）。Bash ツールは呼び出しごとにシェルが新しくなるため、起動と同じコマンドの中で設定する。独立 CLI の指定省略を「親継承」と扱わない。成果物には要求モデル・実行モデル・確認根拠・起動経路を [独立性の申告](../../docs/review-matrix.md) に従って記録する。実行モデルの証拠が取れない場合は「未確認」とし、CLI のバージョンやモデル自身の自己申告で代用しない。

**`CLAUDE_REVIEW_MODEL` が未設定だと、`:?` の行でシェルが非ゼロで終わる**（`EXIT=` の行も出力ファイルも出ず、エラー出力に「要求モデルの識別子を設定する」が出る）。未設定で止まった非ゼロ終了を OAuth 失効（§4）と取り違えない。

**プロンプトの冒頭に「スキル・サブエージェントを使わず、あなた自身が直接レビューする。」を入れ、その直後に「あなたは起動された視点である。手順素材の『起動方法』節（CLI・MCP の起動）は実行せず、スキル・サブエージェントを起動しない（再委託しない）。」を続ける。** 別プロセスの `claude -p` も受け手リポジトリの `.claude/skills`・`.claude/agents` を読み込むため、視点役がレビュー系スキルを発動し、統括者向けの手順（他視点の起動など）を自分に当てるのを防ぐ。下の標準形は、冒頭の1文が無ければ送信前に止める。

```bash
REVIEW_DIR="{§3 で表示された REVIEW_DIR}"
# 設定例: CLAUDE_REVIEW_MODEL=claude-opus-5-5（要求モデルの識別子）
: "${CLAUDE_REVIEW_MODEL:?要求モデルの識別子を設定する}"
CLAUDE_PROMPT_FILE="$REVIEW_DIR/{名前}-prompt.md"   # 4要素プロンプト。本文は二重引用符の中へ直接書かない（§3）
grep -qF 'スキル・サブエージェントを使わず、あなた自身が直接レビューする' "$CLAUDE_PROMPT_FILE" || { echo "プロンプト冒頭の指示がない"; exit 1; }
CLAUDE_PROMPT=$(cat "$CLAUDE_PROMPT_FILE") || exit 1
claude -p --model "$CLAUDE_REVIEW_MODEL" --permission-mode plan --restricted --strict-mcp-config --tools "Read,Grep,Glob" --allowedTools "Read,Grep,Glob" --disable-slash-commands --output-format text \
  "$CLAUDE_PROMPT" \
  < /dev/null > "$REVIEW_DIR/{名前}.md" 2> "$REVIEW_DIR/{名前}.log"
echo "EXIT=$?"
```

| 要素 | 理由 |
|------|------|
| `--permission-mode plan` | 通常設定で書き込みを制限するレビュー用の開始モード。bypassへ切替可能なセッション等を含む全条件での書込不可を保証しない |
| `--restricted` | 利用者・プロジェクト・ローカルの設定ファイル（hook・許可ルール・プラグインの有効化を含む）を読まず、ファイル系ツールを作業ディレクトリ（`--add-dir` で足した先を含む）に限る。コマンド実行系のビルトインと WebFetch も外し、bypassPermissions を拒む（`claude --help` 2.1.296）。作業ディレクトリの外にある内容は、`--add-dir` で足すかプロンプトへ埋め込む。設定ファイルの deny も読まないので、Read の deny（例: `.env`）を守るときはその規則を `--settings` で渡す（managed と `--settings` は効く） |
| `--strict-mcp-config` | `--mcp-config` で渡した MCP サーバーだけを使う。何も渡さないので MCP のツールは0になる（`--restricted` だけでは MCP は外れない） |
| `--tools "Read,Grep,Glob"` | 使えるビルトインを読み取り系に絞り、Bash・Agent・Write 等を出さない（Step 1 参照）。MCP のツールは対象外で、`--strict-mcp-config` で外す |
| `--allowedTools "Read,Grep,Glob"` | 読み取り系ツールのみ確認なしで許可する（Step 1 参照） |
| `--disable-slash-commands` | スキルを無効にする（`claude --help` 2.1.296: 「Disable all skills」）。視点役がレビュー系スキルを発動するのを防ぐ（上記） |
| `--model` | 要求モデルを明示する。モデル名を固定せず、実行モデルは別途確認・記録する |
| `"$CLAUDE_PROMPT"` | 本文はファイルから変数へ読み込んで渡す。二重引用符の中へ直接書くと、バッククォートや `$` が展開される（§3） |
| `REVIEW_DIR` | 実行ごとの出力先（§3）。結果・ログ・プロンプトを別の実行と共有しない |
| `< /dev/null` | 付けないと stdin を待って停止する |
| `> {ファイル} 2> {ログ}` | 応答とエラーログを分離して回収する |
| `echo "EXIT=$?"` | 成否判定。出力ファイルの存在・非空とあわせて確認する |

実測（2026-10-26・claude 2.1.296）: `--restricted --strict-mcp-config` を足す前は、ビルトインは Read・Grep・Glob だけでも MCP のツール 176 個（メール・タスク管理の書き込み系を含む）が残り、利用者の SessionStart hook の出力も混入した。足した上の標準形では、使えるツールは Read・Grep・Glob の3つだけ・MCP のツール0になり、hook の出力は混入せず、作業ディレクトリ内のファイルは Read で読めた。bypass は追加しない。[CLI公式仕様](https://code.claude.com/docs/en/cli-reference)

### Step 3: 疎通確認

```bash
mkdir -p .tmp/ai-review || exit 1   # 出力先の準備（§3）
# 設定例: CLAUDE_REVIEW_MODEL=claude-opus-5-5（要求モデルの識別子。Step 2）
: "${CLAUDE_REVIEW_MODEL:?要求モデルの識別子を設定する}"
claude -p --model "$CLAUDE_REVIEW_MODEL" --permission-mode plan --allowedTools "" --output-format text \
  "ゴールは PONG とだけ返すこと。" < /dev/null > .tmp/ai-review/claude-probe.md 2> .tmp/ai-review/claude-probe.log
echo "EXIT=$?"
```

`EXIT=0` かつ出力ファイルが `PONG` のみ → 疎通OK。`EXIT` が非ゼロ、または出力が空でログに認証関連の文言がある場合は §4 の OAuth 失効ケースを疑う（`CLAUDE_REVIEW_MODEL` 未設定による停止は除く。Step 2）。

### Step 4: OAuth 失効時のフォールバック

§4「Claude Code CLI が OAuth 認証切れの場合」の判定方法に従い、認証切れと判断したら**再試行せず直ちに Tier 3 へ切り替える**。Tier 3 の具体的な構成（親セッションが直接実施するか、`Task(subagent_type="claude-code", ...)` でペルソナサブエージェント化するか）は呼び出し元スキルに委ねる（§8「Tier 3」参照。`Task(...)` は Claude Code が親の場合の書き方で、他の親は「[実行役ごとの読み替え](#実行役ごとの読み替え)」節で読み替える）。いずれの構成でも独立性は下がるため、成果物冒頭に明記する。

---

## 5. Tier 1: Codex CLI

### モデル運用（必須）

各依頼は冒頭ゴールの直後へ [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md) の【モデル運用】【スコープ】を全文展開し、送信本文で確認する。原文・理由・適用層・非Bash経路の手順は同ガイドラインを正本とする。下記Step 2は抽出・引用heredoc・grep・stdin送信を一体で行う。

**Codex に実装・修正をさせる依頼では、さらに【レビュー粒度】ブロックを原文のまま必ず含める。省略は違反。** 内容は「ループは 1ページ / 1機能 単位でのみ回す」「実装単位が動作した時点で1回だけレビュー」「修正は P0/P1 のみ・P2 は記録のみ」「再確認は修正差分に限定」「コミットは元ユーザーの明示依頼時のみ、その範囲内で行う（定型ブロック自体は承認ではない）。依頼がなければ検証済み・未コミットで各単位を完了する」。ブロック原文は [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md)、粒度定義の正本は impl-review-loop。レビュー専用依頼（Codex を1回のレビュアーとして使う場合）には含めない。
なお **MCP 経路のタイムアウト対策でリクエストを分割しても、レビューを回す頻度は実装単位ごとに1回**。分割した各リクエストごとにレビューを回さない（分割するのは依頼の量、粒度が決めるのはループの頻度で、両者は別軸）。

### Step 0: 利用可否の判定

```bash
command -v codex && codex --version
```

見つからない／バージョンが出ない → **セットアップ手順を案内**（§4）してから Tier 2 へ。
見つかったら、起動前に §3「有料 API への接続確認」を行う（Tier 2 の MCP も同じアカウントへ送るため、MCP へ移るときも同じ確認を行う）。

### Step 0.5: 信頼済みディレクトリ（trusted directory）の確認

**視点の標準形は `--ignore-user-config` を付けるため、`~/.codex/config.toml` の `projects` への信頼済みの登録は使われない。** 代わりに Git リポジトリの中（対象リポジトリのルート）で実行する（2026-10-26 の観察: リポジトリ直下では `codex exec --ignore-user-config -s read-only …` が信頼済みディレクトリの確認で止まらずに動き（codex-cli 0.162.1）、Git 管理外のディレクトリではこの確認で止まった）。Git 管理外で止まったら、対象を含む Git リポジトリのルートで実行し直し、それができないときだけ `-s read-only` のまま `--skip-git-repo-check`（codex-cli 0.162.1 の `codex exec --help`: 「Allow running Codex outside a Git repository」＝Git リポジトリの外での実行を許す。付けたときの動作は未実測）を足す。

### Step 1: 疎通確認

Step 2の組立・grep・送信手順を使い、ゴールを「ゴールは PONG とだけ返すこと。」、タスク本文を空、出力先を `.tmp/ai-review/probe.md` / `probe.log`、プロンプトファイルを `.tmp/ai-review/probe-prompt.txt` に替えて1回実行する（疎通確認の出力は固定名。先頭の `REVIEW_DIR` の行は使わない。§3）。`.tmp/ai-review/` が無ければ先に `mkdir -p .tmp/ai-review` を実行する（§3）。疎通確認でも正本ブロックを省略しない。

`EXIT=0` かつ出力ファイルに `PONG` → 疎通OK。失敗時は `probe.log` に理由が残る。

### Step 2: 観点付きレビュー（標準形）

実行ごとの出力先（§3 の `REVIEW_DIR`）を先に用意する。ゴール・タスク本文・出力先の名前を依頼に合わせて埋める。

```bash
REVIEW_DIR="{§3 で表示された REVIEW_DIR}"
codex_guard_blocks=$(awk '
$0 == "<!-- codex-prompt-model-ops:start -->" { if (step != 0) exit 1; step=1; next }
$0 == "<!-- codex-prompt-model-ops:end -->" { if (step != 1) exit 1; step=2; print ""; next }
$0 == "<!-- codex-prompt-scope:start -->" { if (step != 2) exit 1; step=3; next }
$0 == "<!-- codex-prompt-scope:end -->" { if (step != 3) exit 1; step=4; next }
step == 1 || step == 3 { print }
END { if (step != 4) exit 1 }
' .claude/docs/codex-prompt-guideline.md) || exit 1
codex_prompt_file="$REVIEW_DIR/{名前}-prompt.txt"
{
  cat <<'CODEX_GOAL'
ゴールは {対象ファイル} を {観点} でレビューし、根拠付きの指摘を0〜5件返すこと。
CODEX_GOAL
  printf '\n%s\n\n' "$codex_guard_blocks"
  cat <<'CODEX_TASK'
【対象ファイル】{対象ファイル}
【観点】{観点}
【制約】根拠を優先し、件数を埋めない。ファイルを実際に読み、根拠となる行番号を添える（憶測禁止）。修正は行わない。あなたは起動された視点である。手順素材の『起動方法』節（CLI・MCP の起動）は実行せず、スキル・サブエージェントを起動しない（再委託しない）
【完了条件】各指摘に優先度・行番号・内容を揃える。0件なら「指摘なし」と判断根拠を返す
【出力形式】テーブル
CODEX_TASK
} > "$codex_prompt_file" || exit 1
[ "$(grep -cFx '【モデル運用】' "$codex_prompt_file")" -eq 1 ] &&
[ "$(grep -cFx '【スコープ】' "$codex_prompt_file")" -eq 1 ] &&
! grep -qF '{{CODEX_GUARD_BLOCKS}}' "$codex_prompt_file" || exit 1
grep -nE '^【(モデル運用|スコープ)】$' "$codex_prompt_file" || exit 1
codex exec --ignore-user-config -s read-only -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' \
  -o "$REVIEW_DIR/{名前}.md" - < "$codex_prompt_file" > "$REVIEW_DIR/{名前}.log" 2>&1
echo "EXIT=$?"
```

| 要素 | 理由 |
|------|------|
| `--ignore-user-config` | 利用者の `$CODEX_HOME/config.toml`（既定 `~/.codex/config.toml`）を読まない。認証は `CODEX_HOME` のものを使う。実測（2026-10-26・codex-cli 0.162.1）: config.toml で有効にしていた MCP（ブラウザ操作・コンピュータ操作等）が外れた（`-s read-only` はシェルを縛るだけで MCP のツールには効かない）。残るもの: Web 検索・閲覧と、サブエージェントの起動。後者は依頼文に「あなたは起動された視点である。手順素材の『起動方法』節（CLI・MCP の起動）は実行せず、スキル・サブエージェントを起動しない（再委託しない）」を入れて抑える（上の標準形の【制約】。internal-structure-review Step 2 の Codex 例も同じ）。制約: 利用者の config.toml に依存する設定（独自の `model_provider` 等）がある環境では、その設定も外れる。モデルと effort は `-m`・`-c` で明示しているので設定ファイルは要らない。リポジトリ直下では信頼済みディレクトリの問題は起きなかった |
| `-s read-only` | レビュー・調査は読み取りのみ。書き込みが必要な場合だけ `workspace-write` を明示的に選ぶ |
| `-o {ファイル}` | **正常終了時に最終メッセージだけ**を保存する。途中経過は残らない |
| 組立済みプロンプト | 正本の原文をゴール直後へ挿入し、grepで両見出しが各1件・未展開記号が0件と確認してから送る。実装・修正依頼はさらに【レビュー粒度】を含める |
| `- < "$codex_prompt_file"` | プロンプトをstdinへ渡す。この方式に `< /dev/null` は重ねない |
| `> {ログ} 2>&1` | 進捗ログを**捨てずに別ファイルへ**。メインコンテキストを汚さず、失敗理由も残る |
| `echo "EXIT=$?"` | 成否判定。出力ファイルの存在・非空とあわせて確認する |

### Step 3: ネイティブ差分レビュー

```bash
REVIEW_DIR="{§3 で表示された REVIEW_DIR}"
codex exec --ignore-user-config -s read-only review -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' -o "$REVIEW_DIR/diff-review.md" --base main < /dev/null > "$REVIEW_DIR/diff-review.log" 2>&1; echo "EXIT=$?"
codex exec --ignore-user-config -s read-only review -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' -o "$REVIEW_DIR/diff-review.md" --uncommitted < /dev/null > "$REVIEW_DIR/diff-review.log" 2>&1; echo "EXIT=$?"
codex exec --ignore-user-config -s read-only review -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' -o "$REVIEW_DIR/diff-review.md" --commit {SHA} < /dev/null > "$REVIEW_DIR/diff-review.log" 2>&1; echo "EXIT=$?"
```

モデルと reasoning effort は Step 2 と同じく明示する（省略すると受け手の `~/.codex/config.toml` の値になる。`--ignore-user-config` 付きではその値も読まない）。`-m` / `-c` は `review` の後に置く（codex-cli 0.162.1 の `codex exec review --help` に両オプションがある。`-s` は `exec` のオプションなので `review` の前）。`--ignore-user-config`（効果と残るもの: Step 2 の表）は `exec`・`review` の両方の `--help` にあり、`review` の前後どちらに置いても効いた（2026-10-26 実測: 壊した config.toml を置いた `CODEX_HOME` で、付けない形だけが読み込みエラーになった）。本書は `-s` と並べて `review` の前に置く。

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
見つかったら、起動前に §3「有料 API への接続確認」を行う。
バージョンが 1.1.10 以前なら `agy update` で更新する（1.1.10 以前は `--model` が無視され、`gemini-3.1-pro-high` を指定しても既定の Flash で実行されていた。ログで 31 件を確認済み）。

### 🔴 Step 1: モデルを必ず明示する

**`agy` は Gemini 専用ではない。複数モデルを切り替えられる実行基盤である。**
実測（agy 1.4.7、2026-10-26）の `agy models` 出力（ID のみ抜粋。表示名は `agy models` を正本とする）:

```
gemini-4-argon-high / -medium / -low
gemini-3.8-flash-high / -medium / -low
claude-opus-5-5-high / -medium / -low
claude-sonnet-5-5-high / -medium / -low
gpt-oss-120b-medium
```

一覧は agy の更新で頻繁に変わる（1.1.8 → 1.2.5 で `gemini-3.5-flash-*` が消え、3.7 / 3.8 Flash が増えた。1.2.5 → 1.4.2 で `gemini-3.1-pro-*`・3.6 / 3.7 Flash が消え、`gemini-4-argon-*` が増えた。1.4.2 → 1.4.7 では ID の変化なし）。使う前に `agy models` で確認する。

**レビューで指定するモデルは `gemini-4-argon-high`**（表示名 `Gemini 4 Argon (High)`。2026-10-26 にオーナー指定で `gemini-3.8-flash-high` から変更）。**既定モデルは agy の更新で変わる**（実測: agy 1.2.x・2026-09 は `Gemini 3.8 Flash (High)`、agy 1.4.2・2026-10-19 は `Gemini 4 Argon (Medium)`）。モデルを指定しないと、
レビューごとに実行モデルが変わって結果を比べられず、設定次第では Claude が選ばれて
**独立視点そのものが失われる**。

| 用途 | 指定するモデル |
|------|---------------|
| レビュー（観点を問わない。デザイン・UX のほか internal-structure-review・code-review の視点を含む） | `--model gemini-4-argon-high` |
| 疎通確認だけ（結果をレビューに使わない） | 既定で可 |

**Claude 系モデルを選んだ場合は「独立視点」にならない。** 成果物には実際に使ったモデル名を必ず記録する。
実際に使ったモデルは、**実行ごとに `--log-file` で専用のログファイルを指定し**（Step 2 の標準形に含める）、そのログの `label="…"` で確かめる。
既定のログ（`~/.gemini/antigravity-cli/log/cli-{起動時刻}.log`）からは探さない。ファイル名が秒単位の起動時刻なので、同じ秒に起動した並列実行は1つのファイルへ書き込み、内容が上書き・交錯する。別セッションの `agy -p` や、後から起動した `agy models` 等のログとも見分けられない（実測 2026-10-19・agy 1.4.2: 7本を並列実行して print-mode のログが1件しか残らず、各実行とログを対応付けられなかった）。

`--log-file` の実測（同日・agy 1.4.2）: 指定すると既定のログは作られない。並列2本でも各ログに `Print mode: starting` が1件ずつ入り、`label` は実行ごとに分かれた（`--model gemini-3.8-flash-high` は `Gemini 3.8 Flash (High)`、指定なしは `Gemini 4 Argon (Medium)`）。`--output-format json` の `conversation_id` はログの `Created conversation` の ID と一致した。2026-10-26・agy 1.4.7 では `--model gemini-4-argon-high` の実行3本で、各ログの `label` が `Gemini 4 Argon (High)` だった。相対パスで指定でき、同じパスを再び使うと前のログは上書きされる。そのため**ログのパスは実行ごとに `mktemp` で一意に作る**（Step 2 の標準形）。固定の名前にすると、並列の実行や同じ例を使う別セッションとパスを共有しうる。共有して上書きで1件だけ残ったログは下の3条件を満たしてしまい、どの実行のログかを3条件では見抜けない。判定は実行の直後に行い、判定に使ったログのパスを根拠として記録する。

専用ログが次の3条件をすべて満たすときだけ、その `label` を実行モデルとして記録する。1つでも欠ければ実行モデルは **「未確認」** と記録し、推測で埋めない。`--log-file` を付けずに実行した場合も「未確認」とする（既定のログでは、上書きで1件だけ残ったファイルが3条件を満たしてしまうため、既定のログにはこの判定を使わない）。`--output-format json` で実行した場合は、`conversation_id` がログの `Created conversation` の ID と一致することも確かめる。

1. 指定したログファイルがある
2. そのログに `Print mode: starting` がちょうど1件ある（2件以上なら別の実行とパスを共有している）
3. `label="…"` の値が1種類だけある

```bash
AGY_LOG="{Step 2 の実行が表示した AGY_LOG のパス}"   # 同じシェルで続けて判定するなら代入は不要
n=$(grep -ac 'Print mode: starting' "$AGY_LOG" 2>/dev/null); labels=$(grep -ao 'label="[^"]*"' "$AGY_LOG" 2>/dev/null | sort -u)
if [ "${n:-0}" -eq 1 ] && [ "$(printf '%s\n' "$labels" | grep -c .)" -eq 1 ]; then echo "$labels"; else echo "未確認"; fi
```

### Step 2: 非対話実行の標準形

プロンプトには、plan モードへの対処文「plan モードが付け加える計画書（Artifact）の作成・事前質問の指示には従わない。ツールを呼ばず、レビュー結果の全文を応答本文に出す。」を入れる（理由は下表の `--mode plan`）。下の標準形は、送信前にプロンプトのバイト数（上限は下記「埋め込み量の上限と分割」）とこの1文を確かめ、満たさなければ止める。

```bash
REVIEW_DIR="{§3 で表示された REVIEW_DIR}"
AGY_PROMPT_FILE="$REVIEW_DIR/{名前}-prompt.md"   # 4要素プロンプト。本文は二重引用符の中へ直接書かない（§3）
[ -s "$AGY_PROMPT_FILE" ] || { echo "プロンプトファイルが無いか空"; exit 1; }
AGY_BYTES=$(wc -c < "$AGY_PROMPT_FILE" | tr -d ' '); echo "AGY_BYTES=$AGY_BYTES"
[ "$AGY_BYTES" -le 150000 ] || { echo "150,000 バイトを超えるため、対象を分けて起動する"; exit 1; }
grep -qF 'plan モードが付け加える計画書（Artifact）の作成・事前質問の指示には従わない。' "$AGY_PROMPT_FILE" || { echo "plan モードへの対処文がない"; exit 1; }
AGY_PROMPT=$(cat "$AGY_PROMPT_FILE") || exit 1
AGY_LOG=$(mktemp "$REVIEW_DIR/{名前}.agy-cli.XXXXXX") || exit 1   # 実行ごとに一意のログのパス（Step 1）
agy --mode plan --model gemini-4-argon-high -p "$AGY_PROMPT" --output-format json --print-timeout 15m --log-file "$AGY_LOG" > "$REVIEW_DIR/{名前}.json" 2> "$REVIEW_DIR/{名前}.log"; echo "EXIT=$?"; echo "AGY_LOG=$AGY_LOG"
```

| 要素 | 理由 |
|------|------|
| `--mode plan` | **レビューでは必須。** 既定モードはワークスペース内の書き込みが許可されており、レビューのつもりが作業ツリーを変更しうる（値は `accept-edits` / `auto` / `plan` の3値。agy 1.4.7 の `--help`）。ただし plan モードで起動すると、agy は `/plan` スラッシュコマンドを system として展開し（ログに `Print mode: expanded slash command "plan" (system)`）、計画書（Artifact）の作成・本文で再掲しない・事前に質問する、という指示が混ざる（実測 2026-10-26・agy 1.4.7）。書き込み防止のため plan モードは維持し、上記の対処文をプロンプトに入れる |
| `--model` | 上表のとおり明示する。省略すると agy の既定モデル（更新で変わる）になる |
| `-p` | 非対話（headless）実行。1プロンプトを実行して終了する。本文はファイルから変数へ読み込んで渡す（§3）。agy はファイルを読めないことがあるため、判定に要る内容は本文へ埋め込む（下記「headless の権限モデル」） |
| `--output-format` | `text` / `json` / `stream-json` の3値に対応。`text` は応答本文のみ、`json` は実測で `conversation_id` / `status` / `response` / `duration_seconds` / `num_turns` / `usage` を返す一括出力、`stream-json` は逐次イベント出力（通常のレビュー用途では `text` か `json` で足りる） |
| `--print-timeout` | **agy 1.4.7 の `--help` では既定は `0s`（ターンが終わるまで待つ。上限なし）。** 本書は以前「既定は5分（300秒）」と記録していた。既定は版で変わりうるため、既定に頼らず推奨値の `15m` 等を明示的に指定する（`0s` のままだと終わらないターンを待ち続ける）。値は Go の duration 文字列が必須で、単位なしの `900` は不正値で EXIT=2 になる。`15m` または `900s` と単位付きで指定すること（2026-08-17 実測。従来「15分＝`900` 秒指定で成功した」としていた記録は誤り）。複数観点・長文対象を1回にまとめる場合は明示的に延ばす |
| `--log-file` | 実行モデルを確かめる専用ログ（Step 1）。パスは実行ごとに `mktemp` で一意に作り、実行後に表示して記録する。省略すると実行モデルは「未確認」になる |
| `> {ファイル}` | 応答は **stdout**、診断は **stderr**。リダイレクトで結果だけを回収する |
| `echo "EXIT=$?"` | 成功は `0`、失敗は非ゼロ（`stderr` と JSON の `error` に詳細） |

レビュー後は、書き換えが起きていないことを `git status --porcelain` で確認する。

- 継続実行は `--continue`（直近の会話）または `--conversation {id}`。**`--continue` は並列実行中だと別の会話を再開しうる**ため、並列時は `--output-format json` が返す `conversation_id` を控えて `--conversation` で明示指定する
- **`--dangerously-skip-permissions` はレビュー用途で使わない**

#### ⚠️ headless の権限モデル（実測。最も踏みやすい罠。2026-08-16 訂正）

**headless（`-p`）実行では、`command`（シェル実行）だけでなく、ファイル読み取り等のツール呼び出し全般が auto-deny されることがある。** 承認が必要なツール呼び出しは `EXIT=0` のまま出力が空になり、成功と区別がつかない。

```
jetski: no output produced — a tool required the "command" permission that headless mode
cannot prompt for, so it was auto-denied.
```

> ⚠️ **旧記述の訂正**: 以前は「ワークスペース内のファイル読み取りは auto-allow」としていたが、2026-08-16 の実測でこれは誤りと判明した。ファイル読み取りも auto-deny されうるため、対象ファイルの**パスを渡すだけ**では通らない場合がある。

対処は次の優先順。

| # | 対処 | 内容 |
|---|------|------|
| 1（推奨） | **ツール呼び出しをさせない。内容をプロンプトに直接埋め込む** | `agy` にファイルを読ませようとせず、呼び出し側（シェル）が `$(cat {対象ファイル})` 等で先に内容を取得し、プロンプト文字列へ直接埋め込んで渡す。ツール呼び出しそのものが発生しないため auto-deny の対象にならない。1回に埋め込む量は下記「埋め込み量の上限と分割」に従う |
| 2 | 権限を事前付与 | `~/.gemini/antigravity-cli/settings.json` の `permissions.allow` に必要な権限ルール（`command(<target>)` 等）を追加する |
| 3 | 使わない | `--dangerously-skip-permissions` は全ツールを自動承認するため、レビュー用途では選ばない |

あわせて、プロンプト本文で**ツール呼び出しを求めず**、判定に必要な情報（手順・対象ファイルの中身）をすべてプロンプト文字列に含める。「ファイルの読み取りだけで判定する」という指示だけでは、その読み取り自体が auto-deny される可能性がある点に注意する。埋め込む量は次の上限に従う。

#### 埋め込み量の上限と分割（実測）

**1回の `agy -p` に渡すプロンプトは 150,000 バイト以下にする。超えるなら対象を分けて複数回起動する。** 実測（2026-10-26・agy 1.4.7・`gemini-4-argon-high`）: 443,088 バイトのプロンプトは、約 187,600 バイト以降がモデルの入力上 `<truncated 255440 bytes>` に置き換わり、後半のファイルが読まれなかった。`EXIT=0`・status `SUCCESS` のままで、失敗として表に出ない。133KB 前後の2本は全量読まれた。

- 送信前に `wc -c` でプロンプトのバイト数を測る（Step 2 の標準形に含む）
- 分けるときは、共通部分（指示・前提・チェックリスト等）を各回に入れ、対象ファイルだけを振り分ける。どの回がどのファイルを見たかを記録し、結果を統合する。1ファイルだけで上限を超える場合は、行番号付きのまま行範囲で分ける
- 結果を読むときは、応答に「truncated」「切り詰め」等、入力が欠けたことへの言及が無いかも確かめる。あれば、その回の対象を分けて再実行する

### Step 3: 疎通確認

```bash
mkdir -p .tmp/ai-review || exit 1   # 出力先の準備（§3）
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

**実測例（2026-08-16）**: `codex` が利用上限に到達し、リセット日時（2026-08-20）を示すエラーで**即座に失敗した**（待機やリトライでは解消しない）。CLI と MCP は同一アカウントの枠を共有するため、この状態では Codex の Tier 1・Tier 2 とも使用不可。

**有料への切り替えはしない。** CLI が有料クレジットの購入や API キー（従量課金）への切り替えを提案しても受け入れない（§3「有料 API への接続確認」。2026-10-26 オーナー指示）。従来どおり、下の対処のとおり定額の別ツールの視点か Tier 3 へ止めずに切り替えて続行し、成果物に明記する。先へ進む手段が従量課金の接続しか無いときだけ、止めてオペレーターへ確認する。

対処:

1. **Tier 2 へ落とさない**（同じ枠なので無駄）
2. **別ツールの視点で代替する** — Codex が制限中なら Antigravity（`agy`）は別枠なので使える。逆も同じ
3. それも不可なら Tier 3（親セッション上の別視点）へ落とす
4. **復帰予定時刻を成果物に記録する**（例: 「Codex は利用制限のため 2026-08-20 まで利用不可」）

```
{ツール}: 利用制限に到達（復帰予定 {日時}）。同一アカウントのため MCP 経路も利用不可。
{代替手段} で実施したため、当該観点の独立性は低下している。
```

---

## 7. Tier 2: MCP（Codex のみ）

CLI が使えない場合のみ。**タスク分割が必須**である点が CLI との最大の違い。**Claude Code と Antigravity は MCP 経路を持たない**（Tier 1 が使えなければ直接 Tier 3 へ移る）。

- 1リクエスト = 1ファイル / 1観点 / 主張3〜5件
- 疎通確認で threadId を取得し、`mcp__codex__codex-reply` で1件ずつ順次投入する（ツール名は Claude Code が実行役の場合。他の実行役は「[実行役ごとの読み替え](#実行役ごとの読み替え)」節）
- 結果はテキストで返させる（タイムアウトするとファイル出力も消えるため）
- 同一単位が2回タイムアウトしたら、その単位は Tier 3 へ回す

詳細は `.claude/skills/code-review/agents/codex-reviewer.md` の「MCP フォールバック（Tier 2）」節を参照。

---

## 8. Tier 3: 親セッション上の別視点（最終手段）

実ツールが使えない場合の代替。**Codex / Antigravity と、Claude Code 自身とで扱いが異なる。** 親セッションが Claude Code 以外の場合の読み替えは「[実行役ごとの読み替え](#実行役ごとの読み替え)」節。

| 対象視点 | 代替手段 | 用途 |
|---------|---------|------|
| Codex | `.claude/agents/llm-personas/codex.md` | Codex 視点（実務・批判レビュー）を親セッション上で再現 |
| Antigravity | `.claude/agents/llm-personas/antigravity.md` | Antigravity 視点（デザイン・UX・空間把握）を親セッション上で再現 |
| （補助・任意） | `universal-security-reviewer`（本リポジトリに定義は無い。利用者の環境（`~/.claude/agents/` 等）にある場合だけ使う） | セキュリティ観点 |
| （補助・任意） | `universal-performance-analyzer`（同上） | パフォーマンス観点 |
| **Claude Code 自身** | 専用ペルソナ定義ファイルは必須ではない。呼び出し元スキルが定める形（親セッションが直接実施する、または `Task(subagent_type="claude-code", ...)` でペルソナサブエージェント化する。実装例: `internal-structure-review` Step 3）で代替する。親が Claude Code 以外なら親自身が適用する | `claude -p` が未設定／OAuth 失効時の唯一の代替（§4.5 Step 4） |

**Tier 3 は実ツールの等価物ではない。** 同一モデルによる自己レビューであり独立性が下がる（Claude Code 自身が Tier 3 に落ちた場合も同様——review-matrix.md が指摘する「同一セッション内のペルソナは自己レビューになる」がそのまま当てはまる）。成果物には次を必ず記載する。

```
{ツール}: 利用不可（CLI 未設定 / MCP 未接続 / OAuth 失効）。親セッション（{親のツール}）上の別視点で代替したため、独立性は低下している。
```

---

## 9. 禁止事項

- CLI が使えるのに MCP・親セッション上の代替（Tier 3）を選ぶ
- CLI 未設定を検出しながら、セットアップ手順を案内せず黙って下位 Tier へ落ちる
- Tier を下げた事実を成果物に書かない
- 利用制限に達した CLI に対して MCP へフォールバックする（同一枠なので必ず失敗する）
- ツールの強みと無関係な観点を割り当てる（§1 の担当領域を無視する）
- 出力先ディレクトリを作らずに `-o` を指定する（書き込みに失敗し結果を失う）
- CLI の生の標準出力をそのままメインコンテキストへ流す
- `agy` の結果を `EXIT=0` だけで成功と判定する（権限 auto-deny 時は EXIT=0 かつ出力が空になる）
- `agy` へ渡すプロンプトでツール呼び出し（シェルコマンドの実行やファイル読み取り）を求める（headless では auto-deny されうる。§6「headless の権限モデル」参照。内容はプロンプトへ直接埋め込む）
- `codex exec review` に対象指定と観点プロンプトを併用する（`exit 2` になる）
- `review` サブコマンドで `-s read-only` を省略する（**review も設定済み sandbox を継承する**ため、workspace-write 環境ではワークツリーを書き換えられる）
- レビュー用途で `-s danger-full-access` / `--dangerously-bypass-approvals-and-sandbox` / `--dangerously-skip-permissions` を使う
- `codex exec` を信頼済みディレクトリ外で実行する（§5 Step 0.5）
- `claude` の `--allowedTools` と `--tools` を混同する（前者は確認プロンプトの自動承認、後者は利用可能ツール自体の選択。§4.5 Step 1）
- `claude -p` がネストセッションで OAuth 再認証を要求された際、再試行を繰り返す（非対話環境では認証フローを完了できない。直ちに Tier 3 へ切り替える）
- 有料 API（従量課金）に接続しうる、または判定できないまま CLI を呼ぶ。利用上限に達したとき、有料クレジット・API キーへの切り替えを受け入れる（§3「有料 API への接続確認」）
- `agy` へ 150,000 バイトを超えるプロンプトを1回で送る（後半が `EXIT=0` のまま切り詰められる。§6「埋め込み量の上限と分割」）
- Claude Code の Bash の前面実行で打ち切られた視点起動を「CLI 不通」と判定して Tier を下げる（§3「長時間の CLI 実行」）

---

## 10. 適用箇所

| 適用元 | 内容 |
|--------|------|
| `code-review` スキル | レビュー経路と観点の割り当て |
| `code-review/agents/codex-reviewer.md` | Codex 実行手順そのもの |
| `internal-structure-review` スキル | 3視点（Claude Code / Codex / Antigravity）の実CLI起動手順 |
| `agent-review` スキル | 独立レビューの経路選択 |
| `development-orchestration` スキル | 複数視点検証でのツール呼び出し |
| `.claude/agents/llm-personas/*.md` | Tier 3 代替時のペルソナ定義 |
| その他 | 外部AIツールを呼ぶ全ての場面 |
