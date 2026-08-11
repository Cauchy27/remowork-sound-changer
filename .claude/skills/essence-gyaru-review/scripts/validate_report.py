#!/usr/bin/env python3
"""Validate the structure of an essence-gyaru-review report.

Lightweight structural validator only: it checks the heading, the finding
table's column layout, the finding-ID format, the priority tags, and the
zero-finding fixed text. It does NOT perform any digest/snapshot matching,
claim/attempt bookkeeping, or file publishing -- the full manage_evidence.py
machinery from the original project's version was intentionally dropped for
this template's lightweight version.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


POSITIVE_INT_RE = re.compile(r"^[1-9][0-9]*$")
FINDING_ID_RE = re.compile(r"^GYARU-([1-9][0-9]*)-([0-9]{3})$")
PRIORITIES = {"[MUST]", "[SHOULD]", "[NIT]", "[Q]"}

ROOT_HEADING = "# 本質ギャルレビュー"
FINDINGS_HEADING = "## 指摘"
HANDOFF_HEADING = "## ファクトチェック受け渡し"
FINDING_HEADER = ("指摘ID", "優先度", "対象箇所", "根拠", "本質的影響", "最小修正")
FINDING_SEPARATOR = ("---", "---", "---", "---", "---", "---")
ZERO_FINDINGS_TEXT = "本質的な指摘なし。"


class ValidationError(ValueError):
    pass


def validate_iteration(iteration: str) -> None:
    if not POSITIVE_INT_RE.fullmatch(iteration):
        raise ValidationError("iteration must be a positive integer without leading zeros")


def require_line(text: str, line: str) -> int:
    matches = list(re.finditer(rf"^{re.escape(line)}\s*$", text, re.MULTILINE))
    if len(matches) != 1:
        raise ValidationError(f"required heading must occur exactly once: {line}")
    return matches[0].start()


def section_body(text: str, heading: str) -> str:
    match = re.search(rf"^{re.escape(heading)}\s*$", text, re.MULTILINE)
    if match is None:
        raise ValidationError(f"missing section: {heading}")
    start = match.end()
    next_heading = re.search(r"^##\s+", text[start:], re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(text)
    return text[start:end]


def table_cells(line: str) -> tuple[str, ...]:
    return tuple(cell.strip() for cell in line.strip().strip("|").split("|"))


def parse_finding_rows(section: str, iteration: str) -> list[str]:
    section_lines = section.splitlines()

    headers = [
        index
        for index, line in enumerate(section_lines)
        if line.startswith("|") and table_cells(line) == FINDING_HEADER
    ]
    if len(headers) != 1:
        raise ValidationError("finding table header (6 columns) must occur exactly once")

    separators = [
        index
        for index, line in enumerate(section_lines)
        if line.startswith("|") and table_cells(line) == FINDING_SEPARATOR
    ]
    if len(separators) != 1:
        raise ValidationError("finding table separator must occur exactly once")

    header_index = headers[0]
    separator_index = separators[0]
    next_nonempty = next(
        (index for index in range(header_index + 1, len(section_lines)) if section_lines[index]),
        None,
    )
    if next_nonempty != separator_index:
        raise ValidationError("finding table separator must immediately follow the header")

    rows = [
        line
        for index, line in enumerate(section_lines)
        if index > separator_index and re.match(r"^\|\s*GYARU-", line)
    ]

    zero_positions = [
        index for index, line in enumerate(section_lines) if ZERO_FINDINGS_TEXT in line
    ]
    if len(zero_positions) > 1 or (zero_positions and zero_positions[0] <= separator_index):
        raise ValidationError("zero-finding statement must occur at most once, after the table")

    ids: list[str] = []
    for line in rows:
        cells = table_cells(line)
        if len(cells) != 6:
            raise ValidationError(f"finding row must have 6 cells: {line}")
        finding_id, priority, *details = cells
        match = FINDING_ID_RE.fullmatch(finding_id)
        if not match or match.group(1) != iteration:
            raise ValidationError(f"invalid finding ID for iteration {iteration}: {finding_id}")
        if priority not in PRIORITIES:
            raise ValidationError(f"invalid priority tag: {finding_id} -> {priority}")
        if any(not value for value in details):
            raise ValidationError(f"finding row has an empty cell: {finding_id}")
        ids.append(finding_id)

    if len(ids) != len(set(ids)):
        raise ValidationError("finding table contains duplicate IDs")

    if not ids and not zero_positions:
        raise ValidationError(f"zero findings require the fixed text: {ZERO_FINDINGS_TEXT}...")
    if ids and zero_positions:
        raise ValidationError("positive findings must not include the zero-finding fixed text")

    return ids


def parse_handoff(section: str, iteration: str) -> tuple[int, list[str]]:
    count_match = re.search(r"^-\s*指摘件数:\s*(.+?)\s*$", section, re.MULTILINE)
    ids_match = re.search(r"^-\s*全指摘ID:\s*(.+?)\s*$", section, re.MULTILINE)
    if not count_match or not ids_match:
        raise ValidationError("handoff section must contain 指摘件数 and 全指摘ID fields")

    count_raw = count_match.group(1)
    if not re.fullmatch(r"0|[1-9][0-9]*", count_raw):
        raise ValidationError("指摘件数 must be a non-negative integer")

    ids_raw = ids_match.group(1)
    if ids_raw == "なし":
        listed_ids: list[str] = []
    else:
        listed_ids = [value.strip() for value in ids_raw.split(",") if value.strip()]
        if not listed_ids:
            raise ValidationError("全指摘ID must be comma-separated IDs or なし")
        for finding_id in listed_ids:
            match = FINDING_ID_RE.fullmatch(finding_id)
            if not match or match.group(1) != iteration:
                raise ValidationError(f"invalid ID in 全指摘ID: {finding_id}")
        if len(listed_ids) != len(set(listed_ids)):
            raise ValidationError("全指摘ID contains duplicates")

    return int(count_raw), listed_ids


def validate_report_text(text: str, iteration: str) -> None:
    validate_iteration(iteration)

    if not text.strip():
        raise ValidationError("report must be non-empty")
    if not text.startswith(ROOT_HEADING):
        raise ValidationError("report must start with the root heading")

    require_line(text, ROOT_HEADING)
    findings_pos = require_line(text, FINDINGS_HEADING)
    handoff_pos = require_line(text, HANDOFF_HEADING)
    if findings_pos >= handoff_pos:
        raise ValidationError("section order must be 指摘 before ファクトチェック受け渡し")

    findings_section = section_body(text, FINDINGS_HEADING)
    row_ids = parse_finding_rows(findings_section, iteration)

    handoff_section = section_body(text, HANDOFF_HEADING)
    count, listed_ids = parse_handoff(handoff_section, iteration)

    if count != len(row_ids):
        raise ValidationError("指摘件数 does not match the number of finding table rows")
    if set(row_ids) != set(listed_ids) or len(row_ids) != len(listed_ids):
        raise ValidationError("finding table IDs and 全指摘ID do not exactly match")


def validate_report(path: Path, iteration: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValidationError("report must be a regular file")
    text = path.read_text(encoding="utf-8")
    validate_report_text(text, iteration)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path, help="path to the report markdown file")
    parser.add_argument("--iteration", required=True, help="review-iteration value used in this report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_report(args.report, args.iteration)
    except (OSError, UnicodeError, ValidationError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
