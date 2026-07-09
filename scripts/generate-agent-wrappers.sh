#!/usr/bin/env bash
# generate-agent-wrappers.sh
#
# .claude/skills/ の全スキル（正本）から .agents/skills/ 配下の
# Codex / Antigravity (Gemini) 用共通参照ラッパー SKILL.md を機械生成する。
#
# ラッパーは以下を正本から複製する:
#   - name
#   - description（frontmatter の複数行ブロックをそのまま複製）
#   - version
#   - execution_type
# 以下は固定値:
#   - allowed-tools: Read, Bash, Glob, Grep
#   - updated: スクリプト実行日（YYYY-MM-DD）。ただし name/description/version に
#     実質差分が無い既存ラッパーは書き換えず、updated: は据え置く
#     （--check モードの判定と一致させるため）。
#
# 再実行可能（idempotent）。既存ラッパーは実質差分がある場合のみ上書き、欠落分は新規作成する。
# .claude/skills/ に存在しない孤児ラッパーの削除はこのスクリプトでは行わない
# （安全のため、削除は呼び出し側が明示的に判断すること）。
#
# Usage:
#   scripts/generate-agent-wrappers.sh [--check]
#
#   --check : 生成は行わず、差分（作成/更新が必要なファイル）のみ報告する。
#             CI の差分ゲート用途を想定し、差分が1件でもあれば exit 1 する。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_SKILLS_DIR="${REPO_ROOT}/.claude/skills"
AGENTS_SKILLS_DIR="${REPO_ROOT}/.agents/skills"
MODE="${1:-generate}"

if [ ! -d "${CLAUDE_SKILLS_DIR}" ]; then
  echo "ERROR: ${CLAUDE_SKILLS_DIR} が見つかりません" >&2
  exit 1
fi

if [ "${MODE}" != "--check" ]; then
  mkdir -p "${AGENTS_SKILLS_DIR}"
fi

TODAY="$(date +%Y-%m-%d)"

python3 - "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR" "$TODAY" "$MODE" <<'PYEOF'
import sys
import os
import re

claude_dir, agents_dir, today, mode = sys.argv[1:5]

def parse_frontmatter(text):
    """SKILL.md 本文から frontmatter の name / description / version / execution_type を抽出する。
    description は `description: |` 形式のブロックスカラーを想定し、
    次のトップレベルキー（インデント無しで `key:` にマッチする行）までを本文として保持する。
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    # frontmatter 終端 `---` を探す
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return None

    fm_lines = lines[1:end_idx]

    name = None
    version = None
    execution_type = "standalone"
    description_lines = []
    in_description = False

    top_key_re = re.compile(r'^[A-Za-z_][A-Za-z0-9_-]*:')

    for line in fm_lines:
        if in_description:
            # インデントされた行 or 空行はブロック継続
            if line.strip() == "" or line.startswith(" ") or line.startswith("\t"):
                description_lines.append(line)
                continue
            else:
                in_description = False
                # fallthrough: このトップレベルキー行を通常処理へ

        if top_key_re.match(line):
            key, _, rest = line.partition(":")
            key = key.strip()
            rest = rest.strip()
            if key == "name":
                name = rest.strip()
            elif key == "version":
                version = rest.strip()
            elif key == "execution_type":
                execution_type = rest.strip() or "standalone"
            elif key == "description":
                if rest in ("|", ">", "|-", ">-", "|+", ">+", ""):
                    in_description = True
                    description_lines = []
                else:
                    # 単一行 description
                    description_lines = [rest]

    description = "\n".join(description_lines).rstrip("\n")
    return {"name": name, "version": version, "execution_type": execution_type, "description": description}


def to_title(dirname):
    """kebab-case のディレクトリ名を Title Case に変換する（既存ラッパーの慣習に合わせる）。"""
    words = dirname.split("-")
    return " ".join(w.capitalize() for w in words)


def render_wrapper(skill_name, description_block, version, title, allowed_tools, execution_type, updated):
    lines = []
    lines.append("---")
    lines.append(f"name: {skill_name}")
    lines.append("description: |")
    for dline in description_block.splitlines():
        # 既にインデントされているブロックはそのまま、されていなければ2スペース付与
        if dline.strip() == "":
            lines.append("")
        elif dline.startswith("  "):
            lines.append(dline)
        else:
            lines.append("  " + dline.strip())
    lines.append(f"allowed-tools: {allowed_tools}")
    lines.append(f"execution_type: {execution_type}")
    lines.append(f"version: {version}")
    lines.append(f"updated: {updated}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {title}")
    lines.append("")
    lines.append("Codex / Antigravity (Gemini) 共通の参照ラッパー。")
    lines.append("")
    lines.append(f"**詳細な手順と運用ルールは、Claude 側の正本である `.claude/skills/{skill_name}/SKILL.md` に記載されています。**")
    lines.append("エージェントは、必ずファイル読み込みツール（`view_file` など）を使って上記正本を読み込んでから作業を開始してください。")
    lines.append("")
    lines.append("Claude 固有のツール名や手順は、利用可能な同等の手段（例: `run_command`, `invoke_subagent`, `schedule` 等）に読み替えてください。")
    lines.append("")
    return "\n".join(lines)


ALLOWED_TOOLS = "Read, Bash, Glob, Grep"
skill_dirs = sorted(
    d for d in os.listdir(claude_dir)
    if os.path.isdir(os.path.join(claude_dir, d)) and not d.startswith(".")
)

created = []
updated_list = []
skipped_no_frontmatter = []
diffs_needed = []

for skill_name in skill_dirs:
    src_path = os.path.join(claude_dir, skill_name, "SKILL.md")
    if not os.path.isfile(src_path):
        continue

    with open(src_path, "r", encoding="utf-8") as f:
        src_text = f.read()

    meta = parse_frontmatter(src_text)
    if meta is None or not meta.get("name") or not meta.get("version") or not meta.get("description"):
        skipped_no_frontmatter.append(skill_name)
        continue

    title = to_title(skill_name)
    wrapper_text = render_wrapper(
        skill_name=meta["name"],
        description_block=meta["description"],
        version=meta["version"],
        title=title,
        allowed_tools=ALLOWED_TOOLS,
        execution_type=meta["execution_type"],
        updated=today,
    )

    dst_dir = os.path.join(agents_dir, skill_name)
    dst_path = os.path.join(dst_dir, "SKILL.md")

    existed = os.path.isfile(dst_path)
    old_text = None
    if existed:
        with open(dst_path, "r", encoding="utf-8") as f:
            old_text = f.read()

    # updated 日付以外の差分があるかどうかで「実質更新」かを判定
    def strip_updated(text):
        return re.sub(r'^updated:.*$', 'updated: __IGNORED__', text, flags=re.MULTILINE)

    needs_real_update = existed and old_text is not None and strip_updated(old_text) != strip_updated(wrapper_text)
    # updated: のみの差分では書き換えない（--check と判定を一致させる）
    needs_write = (not existed) or needs_real_update

    if mode == "--check":
        if not existed:
            diffs_needed.append(("create", skill_name))
        elif needs_real_update:
            diffs_needed.append(("update", skill_name))
        continue

    if needs_write:
        os.makedirs(dst_dir, exist_ok=True)
        with open(dst_path, "w", encoding="utf-8") as f:
            f.write(wrapper_text)
        if existed:
            updated_list.append(skill_name)
        else:
            created.append(skill_name)

if mode == "--check":
    if diffs_needed:
        print("差分あり:")
        for action, name in diffs_needed:
            print(f"  [{action}] {name}")
    else:
        print("差分なし（全ラッパーが最新）")
    if skipped_no_frontmatter:
        print("frontmatter 解析失敗:", ", ".join(skipped_no_frontmatter))
    sys.exit(1 if diffs_needed else 0)

print(f"新規作成: {len(created)} 件")
for n in created:
    print(f"  + {n}")
print(f"更新: {len(updated_list)} 件")
for n in updated_list:
    print(f"  * {n}")
if skipped_no_frontmatter:
    print(f"スキップ（frontmatter解析失敗）: {len(skipped_no_frontmatter)} 件")
    for n in skipped_no_frontmatter:
        print(f"  ! {n}")
PYEOF
