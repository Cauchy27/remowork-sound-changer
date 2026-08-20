# code-review リファレンス

[SKILL.md](./SKILL.md) の詳細リファレンス。必要なセクションだけを読むこと。

| # | セクション | 内容 |
|---|-----------|------|
| 1 | [3視点の起動コマンド全文](#1-3視点の起動コマンド全文) | 共通プロンプト雛形・Claude Code/Codex/Antigravity の Step0（疎通確認）/Step1（レビュー実行）・Tier 3 フォールバック |
| 2 | [第3層チェックリストの詳細対応表](#2-第3層チェックリストの詳細対応表) | 13項目→正本の観点9つの対応表、Business Logic 項目の特記、ceo-reviewer/cmo-advisor 追加起動テンプレート |
| 3 | [統合レビュー結果テンプレート](#3-統合レビュー結果テンプレート) | Round 3 で出力する最終成果物のフォーマット全文 |

---

## 1. 3視点の起動コマンド全文

### 共通プロンプト雛形（4要素・3視点共通）

```
ゴールは {対象} を観点 {観点番号・名称} でレビューし、優先度付きの指摘を返すこと。

【対象ファイル】{ファイルパスを明示列挙}
【観点】{1〜数観点。正本の観点番号で指定}
【チェックリスト】.claude/skills/code-review/agents/code-checklist-13.md の該当項目を用いる
【制約】根拠となる行番号を添える。ファイルを実際に読んでから判定する（憶測禁止）
【完了条件】各指摘に 優先度・行番号・内容 が揃っている
【出力形式】テーブル
```

**Antigravity（`agy`）実行時のみ、【対象ファイル】をパスのまま渡さず、内容を `cat` で取得してプロンプトへ直接埋め込むこと。** headless 実行はファイル読み取りが auto-deny されうるため、パスだけでは空出力になる（詳細は下記「Antigravity 視点」節）。

**Codex（`codex exec`）実行時のみ、ゴール文の直後に【モデル運用】ブロック（監督=Sol / 実作業=Luna Max / 大問題時のみ Sol・Terra）を原文のまま挿入すること。** 詳細・原文は [`.claude/docs/codex-prompt-guideline.md`](../../docs/codex-prompt-guideline.md) を参照（Claude Code / Antigravity 向けには不要）。
**同じく Codex 実行時のみ、続けて【スコープ】ブロック（ゴール外禁止・着手前3点自己確認）も原文のまま挿入すること。** 原文は同ガイドラインを参照。

3視点とも、下記の Step 0（疎通確認）→ Step 1（レビュー実行、上記プロンプト雛形を埋めて使用）の順で直接実行できる。

### Claude Code 視点（`claude -p`）

**トップレベルセッション自身がレビューを書くのは自己レビューになる。** 正本の実測例（review-matrix.md の「視点を実CLIで実行する理由」）が示すとおり、同一文脈のペルソナは前提ごと見落とす。**別プロセスの `claude -p` を独立して起動すること。**

#### Step 0: 疎通確認

```bash
mkdir -p .tmp/ai-review
claude -p --allowedTools "" "Reply with exactly: PONG" > .tmp/ai-review/claude-probe.log 2>&1; echo "EXIT=$?"
```

`EXIT=0` かつ出力に `PONG` があれば疎通OK。**認証エラー（`Failed to authenticate` 等）が出た場合、ネストした CLI 実行では親セッションと別の OAuth セッションを要求されることがある。** その場合はユーザーに `claude auth` 状態の確認を案内したうえで Tier 3 へフォールバックする。

#### Step 1: レビュー実行

```bash
claude -p --allowedTools "Read,Grep,Glob" --output-format text "{上記の4要素プロンプトを埋めたもの}" > .tmp/ai-review/claude-review.md 2> .tmp/ai-review/claude-review.log
echo "EXIT=$?"
```

| 要素 | 理由 |
|------|------|
| `--allowedTools "Read,Grep,Glob"` | レビューは読み取りのみ。**`--tools`（利用可能ツールの選択）と `--allowedTools`（許可リスト）は両方実在するが意味が異なる。** 読み取り専用レビューは Edit/Write/Bash を許可リストに含めない `--allowedTools` が正しい |
| 標準出力/標準エラーを分離 | 途中経過（stderr）と最終結果（stdout）を混ぜない |
| 結果を読む前に | **EXIT・ファイル存在・非空** の3点を確認する（Codex/Antigravity と同じ作法） |

### Codex 視点（`codex exec`）

#### Step 0: 疎通確認

```bash
codex exec -s read-only -o .tmp/ai-review/codex-probe.md "ゴールは PONG とだけ返すこと。" < /dev/null > .tmp/ai-review/codex-probe.log 2>&1; echo "EXIT=$?"
```

#### Step 1: レビュー実行

```bash
codex exec -s read-only -o .tmp/ai-review/codex-review.md "{上記の4要素プロンプトを埋めたもの}" < /dev/null > .tmp/ai-review/codex-review.log 2>&1; echo "EXIT=$?"
```

`-s read-only` を必ず付ける（読み取り専用）。`< /dev/null` を付けないと stdin 待ちで停止する。`-o` は出力先ディレクトリを先に作らないと書き込みに失敗する。CLI 未設定時のセットアップ案内・MCP フォールバック（Tier 2、タスク分割必須）・ネイティブ差分レビュー（`codex exec review`）は [ai-cli-execution](../ai-cli-execution/SKILL.md) を参照。

### Antigravity 視点（`agy`）

**下記コマンド中のモデル名（`gemini-3.1-pro-high`）は例示。** モデル名は変わりうるため、最新の推奨モデルは [`ai-cli-execution` スキルの reference.md](../ai-cli-execution/reference.md) §6 Step 1 を正本とする。モデル改廃時はそちらのみ更新すればよく、本ファイルの追随は不要。

#### Step 0: 疎通確認

```bash
agy -p "ゴールは PONG とだけ返すこと。" --output-format text > .tmp/ai-review/agy-probe.md 2> .tmp/ai-review/agy-probe.log; echo "EXIT=$?"
```

#### Step 1: レビュー実行（対象ファイルの内容を埋め込む。パスだけを渡すと読めず空出力になる）

**headless（`-p`）実行はファイル読み取り等のツール呼び出しが auto-deny されうる。** `agy` に対象ファイルを読ませようとせず、呼び出し側（シェル）が `cat` で内容を先に取得し、プロンプト文字列へ直接埋め込む（`internal-structure-review` スキルの Antigravity 起動と同じ方式。出典: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §6「headless の権限モデル」）。

```bash
AGY_TARGET=$(cat {対象ファイルを列挙。複数ファイルは cat file1 file2 ... で連結})
agy --mode plan --model gemini-3.1-pro-high -p \
  "{上記の4要素プロンプトを埋めたもの}

## 対象ファイルの内容（ツール呼び出しは行わず、ここに埋め込まれた内容だけで判定すること）
${AGY_TARGET}
" \
  --output-format text --print-timeout 15m > .tmp/ai-review/agy-review.md 2> .tmp/ai-review/agy-review.log; echo "EXIT=$?"
```

`--mode plan` を必ず付ける（既定モードはワークスペースを書き換えうる）。`--model gemini-3.1-pro-high` を省略すると既定の Flash になり独立視点が薄まる。`--output-format text` で Claude Code / Codex（Markdown）と出力形式を揃える（`json` のままだと統合時にパース負荷が生じる）。`--print-timeout 15m` は手順・対象内容を埋め込んだ分プロンプトが長くなるため指定する（既定5分では打ち切られることがある）。値は Go の duration 文字列で指定する必要があり、単位なしの `900` は EXIT=2 でオプション不正となり空出力になる（2026-08-17 実測。`15m` または `900s` と単位を付けること）。`EXIT=0` でも headless の権限 auto-deny で出力が空になることがあるため、**出力ファイルの非空を必ず確認する**。**Antigravity には MCP 経路が無い**（CLI 不可時は Tier 2 を飛ばして直接 Tier 3 へ落ちる。出典: [ai-cli-execution/reference.md](../ai-cli-execution/reference.md) §2・§6）。

本スキル固有の点のみ以下に記す（手順詳細は上記コードブロックと ai-cli-execution 参照）。

- 出力先は本スキル共通で `.tmp/ai-review/` 配下に統一する
- プロンプトの【チェックリスト】欄には `agents/code-checklist-13.md` を指定する（同ファイル末尾の「Codex プロンプトテンプレート」に Go/Next 別のひな形がある）
- **Antigravity はコード実装レビューでも Codex と同格の必須試行**（正本の「対象別の視点・観点セット」で、コード実装は3視点とも使う対象に指定されているため）。デザイン/UI/UX を含まないバックエンドのみの変更でも試行し、利用不可の場合のみ独立性低下を明記して Tier 3 へ落とす

### Tier 3: Task tool + ペルソナ（最終手段）

CLI・MCP のどちらも疎通しない視点だけを、以下で代替する。

```markdown
Task(subagent_type="codex", description="Codex視点レビュー（代替）", prompt="
  .claude/skills/code-review/agents/codex-reviewer.md の手順と
  .claude/skills/code-review/agents/code-checklist-13.md のチェックリストに従い、
  {対象ファイル} を批判的にレビューすること。
")

Task(subagent_type="antigravity", description="Antigravity視点レビュー（代替）", prompt="
  .claude/agents/llm-personas/antigravity.md のペルソナ定義に従い、
  {対象ファイル} をアーキテクチャ・UX・情報設計の観点で批判的にレビューすること。
")
```

**代替が必要な視点は同一メッセージ内で同時起動する**（逐次実行禁止）。Claude Code 視点が Tier 3 に落ちた場合は、トップレベルセッション自身が `agents/code-checklist-13.md` に従ってレビューする（別プロセスを起動できず独立性はさらに下がるため、その旨を必ず明記する）。

`agents/codex-reviewer.md` と `agents/code-checklist-13.md` は**手順書・チェックリストの素材**であり、`subagent_type` として起動できるエージェント定義ではない。記述規約: [agent-invocation-patterns.md](../../docs/agent-invocation-patterns.md)

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

真に経営・事業判断が必要な対象（課金導線の新設・料金体系変更・収益に関わる仕様変更）では、Claude Code が `ceo-reviewer` / `cmo-advisor` を Task で追加起動し、観点6を深く見る（正本の「観点6をさらに深く見る対象では専門エージェントを追加する」規定に対する具体的な配線）。

```markdown
Task(subagent_type="ceo-reviewer", description="経営視点レビュー（観点6追加起動）", prompt="
  {対象} は課金導線/料金体系/収益導線に関わる変更である。
  作る価値があるか・コストが回収できるか・収益導線が成立しているかを、経営者視点で批判的にレビューすること。
")

Task(subagent_type="cmo-advisor", description="マーケティング視点レビュー（観点6追加起動）", prompt="
  {対象} の収益導線・料金訴求が競合と比べ妥当か、独自ポジショニングを損ねていないかをレビューすること。
")
```

観点 7（運用・保守）は特定の項目に固定せず、13項目全体を横断して見る（テストの陳腐化、依存の更新容易性、エラーハンドリングの追跡容易性など）。観点 1（要件充足）・2（アーキテクチャ）・7（運用保守）は正本の**合議観点**であり、Round 1 で複数視点が重複して見る。

---

## 3. 統合レビュー結果テンプレート

総合判定の基準（PASS/WARN/NG、裁定が決着しない場合は保留）は正本（[review-matrix.md](../../docs/review-matrix.md)）を参照。

```markdown
# 統合レビュー結果

**対象**: {機能名/ファイル名}
**使用視点**: Claude Code (claude -p) / Codex (codex exec) / Antigravity (agy)
**実行経路**: {全視点 Tier 1 / 一部 Tier 3 など}
**使用観点**: 1 要件充足 / 2 アーキテクチャ / 3 実装品質 / 4 セキュリティ / 7 運用保守（該当時 6・9 も記載）

## レビュー概要

| 視点         | 評価           | 指摘数 |
| ------------ | -------------- | ------ |
| Claude Code  | PASS/WARN/NG   | X件    |
| Codex        | PASS/WARN/NG   | X件    |
| Antigravity  | PASS/WARN/NG   | X件    |

---

## 修正必要項目（優先度順）

### [MUST] 修正必須

| #   | ファイル | 行番号 | 視点 | 観点 | 内容 |
| --- | -------- | ------ | ---- | ---- | ---- |

### [SHOULD] 推奨修正

| #   | ファイル | 行番号 | 視点 | 観点 | 内容 |
| --- | -------- | ------ | ---- | ---- | ---- |

### [NIT] 検討事項

| #   | ファイル | 行番号 | 視点 | 観点 | 内容 |
| --- | -------- | ------ | ---- | ---- | ---- |

### 判定が割れた項目（Round 2 裁定結果）

| #   | 項目 | 各視点の判定 | 割れの型 | 一次情報 | 裁定 |
| --- | ---- | ------------ | -------- | -------- | ---- |

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
