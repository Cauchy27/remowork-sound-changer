#!/usr/bin/env python3
"""ADR レコードの契約を検査する軽量チェッカー。

architecture スキル（.claude/skills/architecture/SKILL.md）が定める契約のうち、
答えが一意に決まるものだけを機械的に検査する。意味の妥当性（判断が正しいか、
証跡の内容が本当に承認か）は検査しない。それは人間のレビューの仕事である。

使い方:
    python3 scripts/check-adr.py [ADRディレクトリ]        # 既定は .docs/adr
    python3 scripts/check-adr.py --base origin/main       # 確定レコードの改変も検査

終了コード: 0=違反なし / 1=違反あり / 2=対象ディレクトリなし
"""
import argparse
import pathlib
import re
import subprocess
import sys

STATUSES = ("検討中", "確定", "置換", "失効")
REQUIRED = ("status", "決定日", "決定者", "出典")
IMMUTABLE = ("確定", "置換", "失効")
# 旧フォーマット（v1.1.0 以前）の検出用。本文に埋め込まれた status を拾う
LEGACY_STATUS = re.compile(r"^\s*[-*]\s*\*\*ステータス:?\*\*[:：]?\s*(\S+)", re.M)


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None, text
    fm, body = {}, text[m.end():]
    key = None
    for line in m.group(1).split("\n"):
        if re.match(r"^\s*[-]\s+", line) and key:
            fm.setdefault(key + "[]", []).append(line.split("-", 1)[1].strip())
        elif ":" in line and not line.startswith(" "):
            key, _, val = line.partition(":")
            key, fm[key.strip()] = key.strip(), val.strip()
    return fm, body


def check_file(path, text):
    issues = []
    fm, body = parse_frontmatter(text)
    if fm is None:
        legacy = LEGACY_STATUS.search(text)
        hint = f"（本文に「{legacy.group(1)}」が埋め込まれている。reference.md セクション7 の手順で変換する）" if legacy else ""
        return [f"frontmatter がない{hint}"]

    legacy = LEGACY_STATUS.search(body)
    for key in REQUIRED:
        if key not in fm and f"{key}[]" not in fm:
            if key == "status" and legacy:
                issues.append(
                    f"status が frontmatter になく、本文に「{legacy.group(1)}」が埋め込まれている"
                    "（旧フォーマット。reference.md セクション7 の手順で変換する）")
            else:
                issues.append(f"必須キー `{key}` がない")

    status = fm.get("status", "")
    if status and status not in STATUSES:
        issues.append(f"status が不正: `{status}`（{' / '.join(STATUSES)} のいずれか）")

    sources = fm.get("出典[]") or ([fm["出典"]] if fm.get("出典") else [])
    if not sources:
        issues.append("出典が1件もない")
    elif status == "確定":
        for src in sources:
            if re.search(r"(AI|Claude|Codex|Gemini|ChatGPT|この)(との)?(会話|セッション|やりとり)", src):
                issues.append(f"確定レコードの出典が AI との会話を指している: `{src[:60]}`")
            elif not re.search(r"https?://|#[A-Za-z0-9_-]+", src):
                issues.append(f"確定レコードの出典に URL も一意のID もない: `{src[:60]}`")

    if status == "置換" and not fm.get("置換先"):
        issues.append("status が置換だが `置換先` が空")
    if status == "失効" and "## 失効理由" not in body:
        issues.append("status が失効だが `## 失効理由` 節がない")
    return issues


def check_immutability(root, base):
    """確定以降のレコードが base から変更されていないかを検査する。"""
    issues = []
    try:
        changed = subprocess.run(
            ["git", "diff", "--name-only", base, "--", str(root)],
            capture_output=True, text=True, check=True).stdout.split()
    except subprocess.CalledProcessError:
        return [f"git diff に失敗した（比較元 `{base}` を確認する）"]
    for name in changed:
        p = pathlib.Path(name)
        if not p.exists():
            issues.append(f"{name}: レコードが削除されている")
            continue
        old = subprocess.run(["git", "show", f"{base}:{name}"],
                             capture_output=True, text=True)
        if old.returncode != 0:
            continue  # 新規追加
        fm_old, _ = parse_frontmatter(old.stdout)
        if fm_old and fm_old.get("status") in IMMUTABLE:
            issues.append(
                f"{name}: status が「{fm_old['status']}」のレコードが変更されている。"
                "本文は書き換えず、後続 ADR で置換する")
    return issues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=".docs/adr")
    ap.add_argument("--base", help="比較元（例: origin/main）。指定すると確定後の改変も検査する")
    args = ap.parse_args()

    root = pathlib.Path(args.root)
    if not root.is_dir():
        print(f"対象ディレクトリがない: {root}", file=sys.stderr)
        return 2

    total = violations = 0
    for path in sorted(root.rglob("*.md")):
        if path.name.lower() in ("index.md", "readme.md", "_template.md"):
            continue
        total += 1
        for msg in check_file(path, path.read_text(encoding="utf-8")):
            print(f"NG {path}: {msg}")
            violations += 1

    if args.base:
        for msg in check_immutability(root, args.base):
            print(f"NG {msg}")
            violations += 1

    print(f"\nADR {total} 件 / 違反 {violations} 件")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
