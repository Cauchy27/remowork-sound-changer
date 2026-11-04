# code-review リファレンス

[SKILL.md](./SKILL.md) の詳細リファレンス。必要なセクションだけを読むこと。

| # | セクション | 内容 |
|---|-----------|------|
| 1 | [3視点の起動コマンド全文](#1-3視点の起動コマンド全文) | 共通プロンプト雛形・起動前の準備（背景実行・一時ディレクトリ）・準備（実行ごとの出力先とプロンプトファイル）・Claude Code/Codex/Antigravity の Step0（疎通確認）/Step1（レビュー実行）・Tier 3 フォールバック |
| 2 | [第3層チェックリストの詳細対応表](#2-第3層チェックリストの詳細対応表) | 13項目→正本の観点9つの対応表、Business Logic 項目の特記、ceo-reviewer/cmo-advisor 追加起動テンプレート |
| 3 | [統合レビュー結果テンプレート](#3-統合レビュー結果テンプレート) | Round 3 で出力する最終成果物のフォーマット全文 |

---

## 1. 3視点の起動コマンド全文

### 共通プロンプト雛形（3視点共通）

```
ゴールは {対象} を観点 {観点番号・名称} でレビューし、優先度付きの指摘を返すこと。

【共通前提】AIの出力は「仕様を曲解しがちなジュニアのPR」として扱う。レビューするAIやテストを作るAIも仕様を曲解し得る。AI同士の一致を根拠に正本との照合を省かない

【対象ファイル】{ファイルパスを明示列挙}
【対象版・正本】{対象SHA/差分識別、仕様・決定記録のパスと内容}
【不変条件】{正本から導いた業務ルール・受入条件}
【検証状態】{機械検証/CIの結果、未実施・未確認事項}
【観点】{1〜数観点。正本の観点番号で指定}
【チェックリスト】.claude/skills/code-review/agents/code-checklist-13.md の該当項目を用いる
【制約】根拠となる行番号を添える。ファイルを実際に読んでから判定する（憶測禁止）。初回は他レビュアーの結論を読まない。期待値を実装だけから決めない
【完了条件】各指摘に 優先度（[MUST]/[SHOULD]/[NIT]。P0/P1/P2・高/中/低と同じ順に対応）・行番号・内容・成立条件・破られる不変条件・必要な検証 が揃っている。未実施の検証を実施済みにしない
【出力形式】指摘は code-checklist-13.md「結果出力テンプレート」の「検出項目」の表の列（# / 観点 / 優先度 / ファイル:行 / 内容 / 指摘した視点 / 成立条件 / 破られる不変条件 / 必要な検証 / 根拠 / 影響 / 修正案）で出す。先頭6列は review-matrix.md「出力フォーマット」の「一致した指摘」の表と同じ。チェックリスト項目ごとの判定を添えるときは、同テンプレートの「項目別評価」の表で指摘の表と分けて書く
```

**Antigravity（`agy`）実行時のみ、【対象ファイル】【チェックリスト】【対象版・正本】をパスのまま渡さず、対象ファイルの内容・変更差分（`git diff`）・正本仕様の本文・チェックリストの本文・【共通前提】の原文（review-matrix.md）をシェルで取得してプロンプトへ埋め込むこと。** headless 実行はファイル読み取りが auto-deny されうるため、パスだけでは空出力になるか、読めないまま判定される（詳細は下記「Antigravity 視点」節）。

**Codex実行時のみ**、ゴール文の直後に [codex-prompt-guideline.md](../../docs/codex-prompt-guideline.md) の【モデル運用】【スコープ】を全文展開し、送信本文で確認する。CLIは下記の組立・grep手順、非Bash経路は同ガイドラインの文字列展開手順を使う。Claude Code / Antigravity向けには挿入しない。

3視点とも、下記の「共通: 起動前の準備」→ Step 0（疎通確認）→ 準備 → Step 1（レビュー実行、上記プロンプト雛形を埋めて使用）の順で直接実行できる。

### 共通: 起動前の準備（Step 0 より前・3視点共通）

**長時間の CLI は背景実行で起動する。** Claude Code が実行役のとき、Bash ツールの前面実行は既定2分・上限10分で打ち切られる。`codex exec`（xhigh）・`agy -p`・`claude -p` の視点起動（各視点の Step 1）は Bash の背景実行（`run_in_background`）を標準とし、完了通知を待ってから結果ファイルを読む。前面で打ち切られた実行を「CLI 不通」と誤判定して Tier 3 へ落とさない。Codex / Antigravity が実行役のときは、各ツールの長時間実行の手段に従い、タイムアウトを十分に取る（正本: [ai-cli-execution/reference.md §3「長時間の CLI 実行」](../ai-cli-execution/reference.md#長時間の-cli-実行)）。

**一時ディレクトリは、Step 0（疎通確認）を含む最初の書き込みの前に作る。** CLI は出力先の親ディレクトリを作らないため、無いと Step 0 のリダイレクトが失敗し、CLI 不通と誤判定する。`.tmp/` が Git の無視対象でなければ、`.git/info/exclude` に `.tmp/` を足して進める（追跡対象・コミット対象を変えない。未追跡のまま残すと `git status` や `codex exec review --uncommitted` にプロンプト・ログが混ざる）。

```bash
mkdir -p .tmp/ai-review || exit 1
if ! git check-ignore -q .tmp/; then   # 無視対象でなければ .git/info/exclude へ足す（worktree でも正しい場所を git rev-parse で求める）
  exclude_file=$(git rev-parse --git-path info/exclude) &&
  mkdir -p "$(dirname "$exclude_file")" &&
  printf '%s\n' '.tmp/' >> "$exclude_file" || exit 1
fi
git check-ignore -q .tmp/ai-review && echo "IGNORED_OK"
```

それでも `IGNORED_OK` が出ない場合（Git 管理外のディレクトリ等）は、Git 管理外の一時ディレクトリ（`mktemp -d`）を使う（[ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §3）。

### 準備: 実行ごとの出力先とプロンプトファイル

Step 1 の前に、実行ごとの出力先ディレクトリを作る。結果・ログ・プロンプトを固定の名前で置くと、並列の実行や同じ checkout の別セッションの結果で上書きされ、EXIT と非空の確認では見抜けない（[ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §3）。

```bash
mkdir -p .tmp/ai-review && REVIEW_DIR=$(mktemp -d .tmp/ai-review/run.XXXXXX) || exit 1   # 実行ごとに一意の出力先
echo "REVIEW_DIR=$REVIEW_DIR"
```

表示された `REVIEW_DIR` を各視点の Step 1 の先頭に入れる。上記プロンプト雛形を埋めた本文は `$REVIEW_DIR/prompt.md` にファイルとして書き（Write ツール等）、Claude Code と Antigravity はそこから変数へ読み込んで渡す。本文をシェルの二重引用符の中へ直接書くと、バッククォートや `$` がシェルに展開され、送信前に消えるか実行される。Codex は下記の組立手順で本文を別に作る（クォート付きヒアドキュメントなので展開されない）。

### Claude Code 視点（`claude -p`）

**Claude Code が実行役のとき、親セッション（オーケストレーター）自身がレビューを書くのは自己レビューになる。** 正本の実測例（review-matrix.md の「視点を実CLIで実行する理由」）が示すとおり、同一文脈のペルソナは前提ごと見落とす。**実行役を問わず、別プロセスの `claude -p` を独立して起動すること。**

起動前に有料 API への接続確認を行う（[ai-cli-execution/reference.md §3「有料 API への接続確認」](../ai-cli-execution/reference.md#有料-api-への接続確認)）。

#### Step 0: 疎通確認

```bash
mkdir -p .tmp/ai-review
# 設定例: CLAUDE_REVIEW_MODEL=claude-opus-5-5
: "${CLAUDE_REVIEW_MODEL:?要求モデルの識別子を設定する}"
claude -p --model "$CLAUDE_REVIEW_MODEL" --permission-mode plan --disable-slash-commands --allowedTools "" --output-format text "Reply with exactly: PONG" > .tmp/ai-review/claude-probe.log 2>&1; echo "EXIT=$?"
```

`CLAUDE_REVIEW_MODEL` が未設定だと `:?` の行で非ゼロ終了する（`EXIT=` の行は出ず、`CLAUDE_REVIEW_MODEL: 要求モデルの識別子を設定する` と表示される）。未設定で止まった非ゼロ終了を OAuth 失効と取り違えない。`--allowedTools` は値を複数取る（`<tools...>`）ため、直後にプロンプトを置くとツール名として読まれ、プロンプト無しのエラーになる。間に別のオプション（`--output-format text`）を挟む。

`EXIT=0` かつ出力に `PONG` があれば疎通OK。**認証エラー（`Failed to authenticate` 等）が出た場合、ネストした CLI 実行では親セッションと別の OAuth セッションを要求されることがある。** その場合はユーザーに `claude auth` 状態の確認を案内したうえで Tier 3 へフォールバックする。

#### Step 1: レビュー実行

要求モデル・実行モデル・根拠・起動経路を成果物へ記録する。実行モデルが確認できない場合は未確認とする。選定と権限制限の正本は [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §4.5。

```bash
REVIEW_DIR="{準備で表示された REVIEW_DIR}"
# 設定例: CLAUDE_REVIEW_MODEL=claude-opus-5-5
: "${CLAUDE_REVIEW_MODEL:?要求モデルの識別子を設定する}"
REVIEW_BODY=$(cat "$REVIEW_DIR/prompt.md") || exit 1   # 共通プロンプト雛形を埋めた本文
REVIEW_PROMPT="スキル・サブエージェントを使わず、あなた自身が直接レビューする。あなたは起動された視点である。手順素材の『起動方法』節（CLI・MCP の起動）は実行せず、スキル・サブエージェントを起動しない（再委託しない）。

${REVIEW_BODY}"
claude -p --model "$CLAUDE_REVIEW_MODEL" --permission-mode plan --restricted --strict-mcp-config --disable-slash-commands --tools "Read,Grep,Glob" --allowedTools "Read,Grep,Glob" --output-format text "$REVIEW_PROMPT" \
  < /dev/null > "$REVIEW_DIR/claude-review.md" 2> "$REVIEW_DIR/claude-review.log"
echo "EXIT=$?"
```

Claude Code が実行役なら、このコマンドは Bash の背景実行で起動する（「共通: 起動前の準備」）。

| 要素 | 理由 |
|------|------|
| `--disable-slash-commands` | 入れ子の `claude -p` は受け手リポジトリのスキルを読み込む。プロンプトの「レビュー」で code-review 等が発動し、統括者向けの手順（3視点の起動・裁定）を自分に当てるのを防ぐ。冒頭の「スキル・サブエージェントを使わず、あなた自身が直接レビューする」も同じ目的 |
| `--tools "Read,Grep,Glob"` `--allowedTools "Read,Grep,Glob"` | レビューは読み取りのみ。**`--tools`（利用可能ツールの選択）と `--allowedTools`（許可リスト）は両方実在するが意味が異なる。** `--allowedTools` だけではツールの集合が絞られず Bash・Agent も使えるため、`--tools` で読み取り系だけにし、`--allowedTools` で確認なしに通す（実測と詳細: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §4.5 Step 1） |
| `--restricted --strict-mcp-config` | 2026-10-26 の実測で、使えるツールが Read・Grep・Glob だけになり、MCP のツールが0になった。利用者・プロジェクトの設定ファイル（hook を含む）を読まず、ファイル系ツールは作業ディレクトリに限られる（詳細: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §4.5 Step 2） |
| `< /dev/null` | 付けないと stdin を待って止まる（[ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §4.5 Step 2） |
| 標準出力/標準エラーを分離 | 途中経過（stderr）と最終結果（stdout）を混ぜない |
| 結果を読む前に | **EXIT・ファイル存在・非空** の3点を確認する（Codex/Antigravity と同じ作法） |

### Codex 視点（`codex exec`）

起動前に有料 API への接続確認を行う（[ai-cli-execution/reference.md §3「有料 API への接続確認」](../ai-cli-execution/reference.md#有料-api-への接続確認)）。

#### Step 0: 疎通確認

下記Step 1の組立・grep手順を使い、ゴールを「ゴールは PONG とだけ返すこと。」、タスク本文を空、出力先を `.tmp/ai-review/codex-probe.md` / `codex-probe.log`、プロンプトファイルを `.tmp/ai-review/codex-probe-prompt.txt` に替えて疎通を確認する。疎通確認は準備より前に行うため、先頭の `REVIEW_DIR` の行は使わない（`.tmp/ai-review` は「共通: 起動前の準備」で作っておく）。正本ブロックは維持する。

#### Step 1: レビュー実行

```bash
REVIEW_DIR="{準備で表示された REVIEW_DIR}"
codex_guard_blocks=$(awk '
$0 == "<!-- codex-prompt-model-ops:start -->" { if (step != 0) exit 1; step=1; next }
$0 == "<!-- codex-prompt-model-ops:end -->" { if (step != 1) exit 1; step=2; print ""; next }
$0 == "<!-- codex-prompt-scope:start -->" { if (step != 2) exit 1; step=3; next }
$0 == "<!-- codex-prompt-scope:end -->" { if (step != 3) exit 1; step=4; next }
step == 1 || step == 3 { print }
END { if (step != 4) exit 1 }
' .claude/docs/codex-prompt-guideline.md) || exit 1
codex_prompt_file="$REVIEW_DIR/codex-prompt.txt"
{
  cat <<'CODEX_GOAL'
ゴールは {対象} を観点 {観点番号・名称} でレビューし、優先度付きの指摘を返すこと。
CODEX_GOAL
  printf '\n%s\n\n' "$codex_guard_blocks"
  cat <<'CODEX_TASK'
【共通前提】AIの出力は「仕様を曲解しがちなジュニアのPR」として扱う。レビューするAIやテストを作るAIも仕様を曲解し得る。AI同士の一致を根拠に正本との照合を省かない
【対象ファイル】{ファイルパスを明示列挙}
【対象版・正本】{対象SHA/差分識別、仕様・決定記録のパスと内容}
【不変条件】{正本から導いた業務ルール・受入条件}
【検証状態】{機械検証/CIの結果、未実施・未確認事項}
【観点】{正本の観点番号・名称}
【チェックリスト】.claude/skills/code-review/agents/code-checklist-13.md の該当項目を用いる
【制約】根拠となる行番号を添える。ファイルを実際に読んでから判定する（憶測禁止）。初回は他レビュアーの結論を読まない。期待値を実装だけから決めない。修正は行わない。あなたは起動された視点である。手順素材の『起動方法』節（CLI・MCP の起動）は実行せず、スキル・サブエージェントを起動しない（再委託しない）
【完了条件】各指摘に優先度（[MUST]/[SHOULD]/[NIT]。P0/P1/P2・高/中/低と同じ順に対応）・行番号・内容・成立条件・破られる不変条件・必要な検証を揃える。未実施を実施済みにしない。0件なら「指摘なし」と判断根拠を返す
【出力形式】指摘は code-checklist-13.md「結果出力テンプレート」の「検出項目」の表の列（# / 観点 / 優先度 / ファイル:行 / 内容 / 指摘した視点 / 成立条件 / 破られる不変条件 / 必要な検証 / 根拠 / 影響 / 修正案）で出す。先頭6列は review-matrix.md「出力フォーマット」の「一致した指摘」の表と同じ。チェックリスト項目ごとの判定を添えるときは、同テンプレートの「項目別評価」の表で指摘の表と分けて書く
CODEX_TASK
} > "$codex_prompt_file" || exit 1
[ "$(grep -cFx '【モデル運用】' "$codex_prompt_file")" -eq 1 ] &&
[ "$(grep -cFx '【スコープ】' "$codex_prompt_file")" -eq 1 ] &&
! grep -qF '{{CODEX_GUARD_BLOCKS}}' "$codex_prompt_file" || exit 1
grep -nE '^【(モデル運用|スコープ)】$' "$codex_prompt_file" || exit 1
codex exec --ignore-user-config -s read-only -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' \
  -o "$REVIEW_DIR/codex-review.md" - < "$codex_prompt_file" > "$REVIEW_DIR/codex-review.log" 2>&1
echo "EXIT=$?"
```

Claude Code が実行役なら、このコマンド一式は Bash の背景実行で起動する（xhigh は前面実行の上限10分を超えうる。「共通: 起動前の準備」）。

`-s read-only` を必ず付ける（読み取り専用）。`--ignore-user-config` で利用者の config.toml の MCP（ブラウザ・コンピュータ操作等）を外す（`-s read-only` は MCP のツールを縛らない。残るものと制約: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §5 Step 2）。この例は `- < "$codex_prompt_file"` で本文を渡す。引数でプロンプトを渡す例やネイティブ差分レビューでは `< /dev/null` を使う。`-o` は出力先ディレクトリを先に作らないと書き込みに失敗する。CLI 未設定時のセットアップ案内・MCP フォールバック（Tier 2、タスク分割必須）・ネイティブ差分レビュー（`codex exec review`）は [ai-cli-execution](../ai-cli-execution/SKILL.md) を参照。

### Antigravity 視点（`agy`）

**下記コマンド中のモデル名（`gemini-4-argon-high`）は例示。** モデル名は変わりうるため、最新の推奨モデルは [`ai-cli-execution` スキルの reference.md](../ai-cli-execution/reference.md) §6 Step 1 を正本とする。モデル改廃時はそちらのみ更新すればよく、本ファイルの追随は不要（2026-10-26 にオーナー指定で `gemini-3.8-flash-high` から変更）。

起動前に有料 API への接続確認を行う（[ai-cli-execution/reference.md §3「有料 API への接続確認」](../ai-cli-execution/reference.md#有料-api-への接続確認)）。

#### Step 0: 疎通確認

```bash
mkdir -p .tmp/ai-review && agy -p "ゴールは PONG とだけ返すこと。" --output-format text > .tmp/ai-review/agy-probe.md 2> .tmp/ai-review/agy-probe.log; echo "EXIT=$?"
```

#### Step 1: レビュー実行（対象ファイル・変更差分・正本仕様・チェックリスト・共通前提を埋め込む。パスだけを渡すと読めない）

**headless（`-p`）実行はファイル読み取り等のツール呼び出しが auto-deny されうる。** `agy` にファイルを読ませようとせず、呼び出し側（シェル）が内容を先に取得し、プロンプトへ直接埋め込む（`internal-structure-review` スキル Step 2 の Antigravity 例と同じ方式。出典: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §6「headless の権限モデル」）。埋め込むのは、共通プロンプト雛形を埋めた本文（`$REVIEW_DIR/prompt.md`）、【共通前提】の原文（review-matrix.md「全レビュースキル共通の前提」）、【チェックリスト】の本文（`agents/code-checklist-13.md` 全文。Claude Code・Codex がファイルから読むものと同じで、Business Logic の品質ゲートを含む）、【対象版・正本】の正本仕様・決定記録の本文（ファイル名と行番号付き）、変更差分（`git diff`。変更行か既存行かの切り分けに使う）、対象ファイルの内容（ファイル名と行番号付き）の6つ。どれかの読み込みが失敗するか、共通前提の抜き出しが空なら、送信前に止まる。

```bash
REVIEW_DIR="{準備で表示された REVIEW_DIR}"
AGY_PROMPT=$(cat "$REVIEW_DIR/prompt.md") || exit 1   # 共通プロンプト雛形を埋めた本文
AGY_CHECKLIST=$(cat .claude/skills/code-review/agents/code-checklist-13.md) || exit 1
AGY_TARGET=$(awk 'FNR == 1 { print "### " FILENAME } { print FNR ": " $0 }' {対象ファイルを空白区切りで列挙}) || exit 1
AGY_DIFF=$(git diff {差分の指定（例: main...HEAD。未コミットの変更なら HEAD）} -- {対象ファイルを空白区切りで列挙}) || exit 1
AGY_SPEC=$(awk 'FNR == 1 { print "### " FILENAME } { print FNR ": " $0 }' {正本仕様・決定記録のファイルを空白区切りで列挙}) || exit 1   # 正本の文書が無ければ AGY_SPEC='（正本の文書なし）' に替える
REVIEW_PREMISES=$(awk '
/^## 全レビュースキル共通の前提$/ { active=1; next }
active && /^## / { exit }
active { print }
' .claude/docs/review-matrix.md) && [ -n "$REVIEW_PREMISES" ] || exit 1   # 見出しが見つからず空なら止める
AGY_FULL_PROMPT="${AGY_PROMPT}

上記の【共通前提】【チェックリスト】【対象版・正本】【対象ファイル】は、以下に埋め込んだ原文・本文・差分・内容を使う。ツール呼び出しは行わず、ここに埋め込まれた内容だけで判定すること（【制約】の「ファイルを実際に読んでから判定する」は、埋め込んだ内容を読むことを指す）。plan モードが付け加える計画書（Artifact）の作成・事前質問の指示には従わない。ツールを呼ばず、レビュー結果の全文を応答本文に出す。出力は【出力形式】【完了条件】に従う。

## 共通前提（review-matrix.md）
${REVIEW_PREMISES}

## チェックリスト（code-checklist-13.md）
${AGY_CHECKLIST}

## 正本仕様・決定記録の本文（各行の先頭は行番号）
${AGY_SPEC}

## 変更差分（git diff）
${AGY_DIFF}

## 対象ファイルの内容（各行の先頭は行番号）
${AGY_TARGET}
"
AGY_BYTES=$(printf '%s' "$AGY_FULL_PROMPT" | wc -c | tr -d ' ') && echo "AGY_BYTES=$AGY_BYTES"
[ "$AGY_BYTES" -le 150000 ] || { echo "150,000 バイトを超えた。対象を分けて起動し直す"; exit 1; }
AGY_LOG=$(mktemp "$REVIEW_DIR/agy-review.agy-cli.XXXXXX") || exit 1   # 実行ごとに一意のログのパス
agy --mode plan --model gemini-4-argon-high -p "$AGY_FULL_PROMPT" \
  --output-format text --print-timeout 15m --log-file "$AGY_LOG" \
  > "$REVIEW_DIR/agy-review.md" 2> "$REVIEW_DIR/agy-review.log"
echo "EXIT=$?"; echo "AGY_LOG=$AGY_LOG"
if grep -qiE 'truncated|切り詰め' "$REVIEW_DIR/agy-review.md"; then echo "TRUNCATION_MENTIONED"; fi   # 出たら後半が読まれていない
```

Claude Code が実行役なら、このコマンド一式は Bash の背景実行で起動する（`--print-timeout 15m` は前面実行の上限10分を超える。「共通: 起動前の準備」）。

**送信前にプロンプトのバイト数を測り、150,000 バイトを超えるなら対象を分けて複数回起動する。** 超えた分は EXIT=0 のまま入力から切り詰められ、後半のファイルが読まれない（実測と分け方の正本: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §6「埋め込み量の上限と分割（実測）」）。上の例は超えたら止まる。対象ファイル（と対応する差分・正本）を振り分け、分けた回ごとに `AGY_LOG` と出力ファイルの名前を変えて起動し、どの回がどのファイルを見たかを記録する。応答に「truncated」「切り詰め」等の言及がある場合（`TRUNCATION_MENTIONED`）も、全量が読まれていないものとして分けて起動し直す。

`AGY_DIFF` は変更行の特定に使う。新規の未追跡ファイルは `git diff` に出ないが、対象ファイルの内容として全文が入る。差分の無い全体レビューなら空でよい。正本の文書が無い場合、Business Logic 項目はチェックリストの品質ゲートに従い「要親判断」になりうる。

`--mode plan` を必ず付ける（既定モードはワークスペースを書き換えうる）。`--mode plan` で起動すると agy は `/plan` スラッシュコマンドを system として展開し、計画書（Artifact）の作成・本文で再掲しない・事前に質問する、という指示が混ざる（実測 2026-10-26・agy 1.4.7）。書き込み防止のため `--mode plan` は維持し、上の埋め込み文の「plan モードが付け加える…指示には従わない」で打ち消す。`--model gemini-4-argon-high` を省略すると agy の既定モデル（更新で変わる）で実行され、独立視点が薄まる。`--log-file` は実行モデルを確かめる専用ログで、パスは実行ごとに `mktemp` で一意に作る。表示された `AGY_LOG` が [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §6 Step 1 の条件を満たさなければ、実行モデルは「未確認」と記録する（期待値の例: `label="Gemini 4 Argon (High)"`）。`--output-format text` で Claude Code / Codex（Markdown）と出力形式を揃える（`json` のままだと統合時にパース負荷が生じる）。`--print-timeout 15m` は、チェックリスト・共通前提・対象内容を埋め込んだ分プロンプトが長くなるため、推奨値として明示的に指定する（既定は版で変わりうる。agy 1.4.7 の `--help` では既定 `0s`＝ターンが終わるまで待つ。[ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §6 Step 2）。値は Go の duration 文字列で指定する必要があり、単位なしの `900` は EXIT=2 でオプション不正となり空出力になる（2026-08-17 実測。`15m` または `900s` と単位を付けること）。`EXIT=0` でも headless の権限 auto-deny で出力が空になることがあるため、**出力ファイルの非空を必ず確認する**。**Antigravity には MCP 経路が無い**（CLI 不可時は Tier 2 を飛ばして直接 Tier 3 へ落ちる。出典: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §2・§6）。

本スキル固有の点のみ以下に記す（手順詳細は上記コードブロックと ai-cli-execution 参照）。

- 出力先は `.tmp/ai-review/` 配下に、実行ごとに `mktemp -d` で作ったディレクトリ（`REVIEW_DIR`）とする。3視点の結果・ログ・プロンプトと agy の専用ログをそこへまとめる
- プロンプトの【チェックリスト】欄には `agents/code-checklist-13.md` を指定する（同ファイル末尾の「Codex プロンプトテンプレート」に Go/Next 別のひな形がある）。Antigravity にはパスではなく本文を埋め込む（上記 Step 1）
- **Antigravity はコード実装レビューでも Codex と同格の必須試行**（正本の「対象別の視点・観点セット」で、コード実装は3視点とも使う対象に指定されているため）。デザイン/UI/UX を含まないバックエンドのみの変更でも試行し、利用不可の場合のみ独立性低下を明記して Tier 3 へ落とす

### Tier 3: Task tool + ペルソナ（最終手段）

CLI・MCP のどちらも疎通しない視点だけを、以下で代替する。下記は Claude Code が実行役の場合の書き方で、それ以外の実行役は [ai-cli-execution/reference.md の「実行役ごとの読み替え」](../ai-cli-execution/reference.md#実行役ごとの読み替え) に従ってサブエージェント起動を読み替える。

```markdown
Task(subagent_type="codex", description="Codex視点レビュー（代替）", prompt="
  AIの出力は「仕様を曲解しがちなジュニアのPR」として扱う。
  .claude/docs/review-matrix.md の共通前提に従い、正本と照合する。
  許可範囲: 読み取りとレビュー結果の返却のみ。対象ファイルの編集・コミット・外部送信は行わない。
  対象版・正本: {対象SHA/差分識別、仕様・決定記録}
  不変条件・検証状態: {受入条件、機械検証/CIの結果、未確認事項}
  観点1/2/3/4/7で、セキュリティとエッジケースも反例を探す。初回は他視点の結論を読まない。
  .claude/agents/llm-personas/codex.md のペルソナ定義と
  .claude/skills/code-review/agents/code-checklist-13.md のチェックリストに従い、
  {対象ファイル} を批判的にレビューすること。
")

Task(subagent_type="antigravity", description="Antigravity視点レビュー（代替）", prompt="
  AIの出力は「仕様を曲解しがちなジュニアのPR」として扱う。
  .claude/docs/review-matrix.md の共通前提に従い、正本と照合する。
  許可範囲: 読み取りとレビュー結果の返却のみ。対象ファイルの編集・コミット・外部送信は行わない。
  対象版・正本: {対象SHA/差分識別、仕様・決定記録}
  不変条件・検証状態: {受入条件、機械検証/CIの結果、未確認事項}
  観点1/2/3/4/7で、セキュリティとエッジケースも反例を探す。初回は他視点の結論を読まない。
  .claude/agents/llm-personas/antigravity.md のペルソナ定義と
  .claude/skills/code-review/agents/code-checklist-13.md のチェックリストに従い、
  {対象ファイル} を批判的にレビューすること。構造・運用保守を重点確認し、UIがある場合はUX・情報設計も確認する。
")
```

**代替が必要な視点は同一メッセージ内で同時起動する**（逐次実行禁止）。Claude Code 視点が Tier 3 に落ちた場合は、親セッション（オーケストレーター）自身が `agents/code-checklist-13.md` に従ってレビューする（別プロセスを起動できず独立性はさらに下がるため、その旨を必ず明記する）。

`agents/codex-reviewer.md` と `agents/code-checklist-13.md` は**手順書・チェックリストの素材**であり、`subagent_type` として起動できるエージェント定義ではない。`agents/codex-reviewer.md` は Codex の CLI・MCP を起動する手順書なので、Tier 3 の代替プロンプトには指定しない（読ませると CLI・MCP を再び試して止まる）。記述規約: [agent-invocation-patterns.md](../../docs/agent-invocation-patterns.md)

独立性が下がった視点は、正本の「独立性の申告」フォーマットに従い結果冒頭に明記する（本スキルでの再掲はしない）。

---

## 2. 第3層チェックリストの詳細対応表

### 13項目 → 正本の観点9つ 対応表

| # | チェックリスト項目 | 対応する観点（正本） |
|---|-------------------|---------------------|
| 1 | Readability（可読性） | 3 実装品質・エッジケース |
| 2 | Naming（命名規則） | 3 実装品質・エッジケース |
| 3 | Code Structure（コード構造） | 2 アーキテクチャ・構造 |
| 4 | Input Validation（入力検証） | 4 セキュリティ |
| 5 | Auth（認証・認可） | 4 セキュリティ |
| 6 | Query Efficiency（クエリ効率） | 3 実装品質・エッジケース |
| 7 | Memory（メモリ・並行） | 3 実装品質・エッジケース |
| 8 | Test Coverage（テストカバレッジ） | 3 実装品質・エッジケース |
| 9 | Test Quality（テスト品質） | 3 実装品質・エッジケース |
| 10 | API Design（API設計） | 2 アーキテクチャ・構造 |
| 11 | Dependency（依存関係） | 2 アーキテクチャ・構造 |
| 12 | Error Handling（エラーハンドリング） | 3 実装品質・エッジケース（ユーザー列挙防止に関わる箇所は 4 セキュリティも兼ねる） |
| 13 | Business Logic（ビジネスロジック） | 3 実装品質・エッジケース（金額・税・状態遷移など、**決定済みの業務ルールを正しく実装したか**を問う実装正確性チェック）。フロントエンド重点チェック #7「画面遷移・導線の仕様適合」のみ 1 要件充足（仕様との整合を問う項目のため） |

**観点6（経営・事業）と項目13を安易に一致させない。** 項目13は「決定済みの業務ルールを正しく実装したか」という実装正確性チェックであり、観点6（作る価値がない/コストが回収できない/収益導線が無い、という戦略判断）とは性質が異なる。両者を一律対応させると、Claude Code の主担当が実質は項目13を消化するだけで、経営判断そのものは行われず空回りする。

真に経営・事業判断が必要な対象（課金導線の新設・料金体系変更・収益に関わる仕様変更）では、親セッション（オーケストレーター）が `ceo-reviewer` / `cmo-advisor` を Task で追加起動し、観点6（Claude Code 視点の重点担当）を深く見る（正本の「観点6をさらに深く見る対象では専門エージェントを追加する」規定に対する具体的な配線）。Claude Code 以外の実行役は [ai-cli-execution/reference.md の「実行役ごとの読み替え」](../ai-cli-execution/reference.md#実行役ごとの読み替え) に従って Task を読み替える。

```markdown
Task(subagent_type="ceo-reviewer", description="経営視点レビュー（観点6追加起動）", prompt="
  {対象} は課金導線/料金体系/収益導線に関わる変更である。
  作る価値があるか・コストが回収できるか・収益導線が成立しているかを、経営者視点で批判的にレビューすること。
")

Task(subagent_type="cmo-advisor", description="マーケティング視点レビュー（観点6追加起動）", prompt="
  {対象} の収益導線・料金訴求が競合と比べ妥当か、独自ポジショニングを損ねていないかをレビューすること。
")
```

観点 7（運用・保守）は特定の項目に固定せず、13項目全体を横断して見る（テストの陳腐化、依存の更新容易性、エラーハンドリングの追跡容易性など）。コードでは観点 1・2・3・4・7 が正本の**合議観点**であり、Round 1 でセキュリティとエッジケースも複数視点が重複して見る。

---

## 3. 統合レビュー結果テンプレート

総合判定の基準（PASS/WARN/NG、裁定が決着しない場合は保留）は正本（[review-matrix.md](../../docs/review-matrix.md)）を参照。

**指摘 ID**: [MUST]/[SHOULD]/[NIT] と「判定が割れた項目」の各行に、統合結果の中で一意の `REV-{3桁}`（表をまたいだ通し番号。`REV-001` から）を振る。同じ指摘を2つの表に書くときは同じ ID を使う。本質ギャルレビューの行は `GYARU-{review-iteration}-{3桁}` をそのまま使う。Round 4（`code-review-fact-check` スキル）は REV-* と GYARU-* の全 ID を入力にし、ID 数で判定の漏れを確かめる。

```markdown
# 統合レビュー結果

**対象**: {機能名/ファイル名}
**使用視点**: Claude Code (claude -p) / Codex (codex exec) / Antigravity (agy)
**実行経路**: {全視点 Tier 1 / 一部 Tier 3 など}
**使用観点**: 1 要件充足 / 2 アーキテクチャ / 3 実装品質 / 4 セキュリティ / 7 運用保守（該当時 6・9 も記載）
**対象版・正本**: {対象SHA/差分識別、仕様・決定記録}
**周回**: 網羅 n/3（実装の途中で呼ばれた場合は「網羅 n/1」。差分レビューの回は「・差分 k 回目」と見た範囲を足す。数え直すまでは `review-iteration` = n で、数え直した後は `review-iteration` を併記する）
**未確認事項・人間判断待ち**: {未検査の範囲、仕様解釈・代償・承認待ち}

## 不変条件と検証記録

| 正本の不変条件 | 検証した反例/成立条件 | 対応テスト・実行結果 | 未確認事項 |
|---|---|---|---|

| 機械検証 | 対象版 | コマンド/CI実行参照 | 結果 |
|---|---|---|---|

AIレビューのPASSと、機械検証のPASS、人間の承認、マージ済みを別々に記録する。

## レビュー概要

| 視点         | 評価           | 指摘数 |
| ------------ | -------------- | ------ |
| Claude Code  | PASS/WARN/NG   | X件    |
| Codex        | PASS/WARN/NG   | X件    |
| Antigravity  | PASS/WARN/NG   | X件    |

---

## 修正必要項目（優先度順）

### [MUST] 修正必須

| ID      | 観点 | 優先度 | ファイル:行 | 内容 | 指摘した視点 |
| ------- | ---- | ------ | ----------- | ---- | ------------ |

### [SHOULD] 推奨修正

| ID      | 観点 | 優先度 | ファイル:行 | 内容 | 指摘した視点 |
| ------- | ---- | ------ | ----------- | ---- | ------------ |

### [NIT] 検討事項

| ID      | 観点 | 優先度 | ファイル:行 | 内容 | 指摘した視点 |
| ------- | ---- | ------ | ----------- | ---- | ------------ |

### 判定が割れた項目（Round 2 裁定結果）

| ID      | 項目 | 各視点の判定 | 割れの型 | 一次情報 | 裁定 |
| ------- | ---- | ------------ | -------- | -------- | ---- |

### 本質ギャルレビュー（横断ゲート・別枠、3視点/13項目のカウント外）

| #   | 指摘ID | 優先度 | 内容 |
| --- | ------ | ------ | ---- |

---

## 良い点

1. ...
2. ...

---

## 総合評価: PASS / WARN / NG / 保留
```
