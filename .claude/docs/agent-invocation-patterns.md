---
title: エージェント発動導線の記述規約
date: 2026-07-30
tags: [agent, skill, invocation, convention]
---

# エージェント発動導線の記述規約

スキルからサブエージェントを起動する際の記述形式を定める。
**散文で「〇〇エージェントが担当する」と書くだけでは起動されない。** 実行可能な呼び出しブロックを必ず置くこと。

## 前提: subagent_type として解決される場所

Claude Code が `subagent_type` に解決するのは **`.claude/agents/**/*.md` のみ**。
`.claude/skills/{skill}/agents/*.md` は登録されない。スキル内蔵の md を `subagent_type` に指定しても起動できない。

## 3 つの記述形式

### 形式A: 専用エージェント起動

グローバル（`.claude/agents/`）に専用の定義があり、そのペルソナと手順をそのまま使う場合。

```markdown
Task(
  subagent_type="tech-researcher",
  description="技術調査",
  prompt="
    調査テーマ: {テーマ}
    出力先: .tmp/{task}/tech-research.md に書き出し、本文への返答は3-5行の要約のみとすること。
  "
)
```

実装例: [research/SKILL.md](../skills/research/SKILL.md)

### 形式B: 素材読み込み起動

スキル固有のワークフローステップで、独立したエージェント型にする価値がない場合。
内蔵 md は「エージェント定義」ではなく**プロンプト素材**として扱う。

```markdown
Task(
  subagent_type="general-purpose",
  description="TSV生成",
  prompt="
    .claude/skills/debug-sheet/agents/tsv-generator.md を読み込み、
    その手順に従って以下のテストケース設計から TSV を生成すること: {入力}
  ",
  model="sonnet"
)
```

実装例: [troubleshooting/SKILL.md](../skills/troubleshooting/SKILL.md)

### 形式C: ペルソナ + 手順素材

グローバルに**汎用ペルソナ**があり、スキル側に**そのペルソナで実行させたい固有手順**がある場合。
`subagent_type` でペルソナを指定し、prompt で手順素材を読ませる。
`general-purpose` より精度が高く、かつグローバルのペルソナ定義を汚染しない。

```markdown
Task(
  subagent_type="claude-code",
  description="Claude Code視点の構造レビュー（CLI未設定時のTier 3代替）",
  prompt="
    .claude/skills/internal-structure-review/agents/claude-code-reviewer.md の手順に従い、
    観点1/2/7/8で {対象} をレビューすること。
  "
)
```

実装例: [internal-structure-review/SKILL.md](../skills/internal-structure-review/SKILL.md)（ただし正本の実行経路は実CLI優先。この形式C は Tier 3 代替時のみ使う。詳細: `.claude/docs/review-matrix.md`）

## 形式の選び方

| 条件 | 形式 |
| --- | --- |
| グローバルに専用定義があり、それだけで完結する | A |
| スキル固有の手順で、ペルソナ性が不要 | B |
| グローバルのペルソナ性 ＋ スキル固有の手順 | C |

## 必須要件

スキルがサブエージェントを使う場合、以下をすべて満たすこと。

1. `allowed-tools` に `Task` を含める
2. `subagent_type` を必ず明示する（省略・散文での言及は不可）
3. 並列起動する場合は「1 つのレスポンス内で同時起動する（逐次実行禁止）」と明記する
4. 出力先ファイルと「本文への返答は 3-5 行の要約のみ」をプロンプトに含める（コンテキスト節約）
5. 内蔵 `agents/*.md` を参照する場合は、それが**素材であり subagent_type ではない**ことが読み取れる書き方にする

## 検証

以下を `self-check` / `internal-structure-review` / pre-commit hook で機械的に検証する。

- スキル本文の `subagent_type="X"` の X が `.claude/agents/**` に実在するか
- 内蔵 `agents/` を持つスキルの `allowed-tools` に `Task` があるか
- 内蔵 `agents/` の名前がグローバルと重複していないか（二重定義の検出）

## 配布時の依存解決

SKILL.md だけを配布すると、参照先が配布先に存在せず**起動できない参照を作ってしまう**。
横展開では次の3点をセットで配ること。

1. SKILL.md
2. 参照する `subagent_type` のエージェント定義（`.claude/agents/{category}/`）
3. prompt が読ませる内蔵素材（`.claude/skills/{skill}/agents/`）

配布後は必ず配布先で `validate-agent-invocation.py --root <配布先>` を実行し、違反ゼロを確認する。

## 横展開時の注意

配布先リポジトリでは、そのリポジトリで**使用実績のないエージェントは削除してよい**。
本テンプレートは全 112 体を保持するが、配布先は実態に合わせて絞り込む。
