#!/usr/bin/env bash
#
# validate-ai-docs.sh
#
# AI ドキュメント（CLAUDE.md / AGENTS.md / README.md / DESIGN.md / .claude/**）の
# 「壊れていないこと」を機械検証する可搬スクリプト。
#
# validate-structure.sh との違い:
#   validate-structure.sh … 本テンプレートリポジトリ専用（.claude/ ⇔ templates/ の双方向同期検証を含む）
#   validate-ai-docs.sh   … 配布先リポジトリで単体動作する。templates/ の存在を前提にしない
#
# macOS 標準の bash 3.2 / BSD grep・sed・find で動作すること（GNU 拡張禁止）。
#
# 検証項目:
#   [1] SKILL.md の frontmatter（--- 開始・name:・description:）
#   [2] SKILL.md の name: とディレクトリ名の一致
#   [3] .claude/agents/**/*.md の frontmatter（name:・description:）
#  [3b] エージェント定義の name: とファイル名の一致
#  [3w] エージェント定義の model: 欠落（警告。親継承でも `model: inherit` と書く。
#       .claude/docs/frontmatter-policy.md §2。[1]〜[9] の FAIL 基準は変えない）
#   [4] Markdown リンクが指すリポジトリ内パスの実在（リンク切れ検出）
#  [4b] バッククォート表記のリポジトリ内パスの実在（警告。刈り込み後の死に参照検出。
#       対象の接頭辞は .claude/ .agents/ .docs/ .workflows/ templates/ scripts/ docs/）
#   [5] 未置換プレースホルダ（{UPPER_CASE} 形式）の残存（ルート4文書 = FAIL）
#  [5b] 同上（.claude/skills|docs|rules 配下 = WARN。配備時のローカライズ漏れ検出用）
#   [6] .claude/ .agents/ 配下のファイル名・ディレクトリ名の多バイト文字（.docs/ docs/ は WARN）
#   [7] Markdown テーブルの見出し行とデータ行の列数一致
#   [8] frontmatter version と「## Version History」表の最大 semver の一致
#   [9] ルート CLAUDE.md の存在（Claude Code が読む正規位置）
#  [10] 実体の無いスキル名の参照（廃止一覧 scripts/retired-skills.txt の名前が本文に残っていないか。
#       別欄集計。[1]〜[9] の RESULT 行・終了コードには含めない）
#  [11] 名指し表の名前の実在（警告。CLAUDE.md と templates/CLAUDE.md の「## スキル参照」節の表にある
#       バッククォート名が .claude/skills/<name>/ に在るか。表が無ければ 0 件として集計し SKIP にしない）
#
# 使い方:
#   bash scripts/validate-ai-docs.sh            # 全項目
#   bash scripts/validate-ai-docs.sh 4          # 項目4のみ（引数は項目番号 1〜11 を1つだけ。3=[3][3b][3w]・4=[4][4b]・5=[5][5b]・6=[6][6w]）
#   bash scripts/validate-ai-docs.sh 10         # [10] のみ（FAIL=1 / 未検査（廃止一覧なし）=2 / それ以外=0）
#   bash scripts/validate-ai-docs.sh 11         # [11] のみ（WARN 級。AIDOC_STRICT=1 のときだけ WARN で exit 1）
#   AIDOC_ISR_MANIFEST=/abs/changes.json bash scripts/validate-ai-docs.sh isr
#     機械診断だけ（独立レビューは未実施）。manifest形式は ISR スキル「機械診断モード」。
#     未指定時は在庫の計測のみで exit 2。数字1〜11と通常の全項目実行の契約は維持する。
#   bash scripts/validate-ai-docs.sh --help     # この使い方を表示
#   AIDOC_STRICT=1 bash scripts/validate-ai-docs.sh   # WARN も FAIL 扱い
#   AIDOC_ROOT=/path/to/repo bash scripts/validate-ai-docs.sh  # 他リポジトリを対象に実行（対象は引数ではなく環境変数で渡す）
#   AIDOC_RETIRED_LIST=/abs/path/retired-skills.txt bash scripts/validate-ai-docs.sh  # [10] の一覧を明示指定
#   AIDOC_LIST_RETIRED=1 bash scripts/validate-ai-docs.sh      # [10] の WARN を一覧表示
#   AIDOC_LIST_BT=1 / AIDOC_LIST_PH=1 / AIDOC_LIST_MBW=1 / AIDOC_LIST_MODEL=1  # [4b] / [5b] / [6w] / [3w] を一覧表示
#
#   [4b]・[5b]・[6w]・[3w] は既定では件数を1行にまとめて出す。`.aidocignore` は一覧表示の有無に
#   かかわらず1指摘ずつ照合し、抑止した分を件数から除いて RESULT 行の ignored= に数える。
#
# 除外設定:
#   リポジトリルートに `.aidocignore` を置くと、1行1パターン（BSD grep の基本正規表現）に
#   マッチする指摘を抑止する。空行と `#` 始まりはコメント。
#   意図的なプレースホルダ・意図的な多バイト名など、そのリポジトリで正しい状態にのみ使う。
#
# 終了コード: 0 = PASS, 1 = FAIL, 2 = 未検査
#   （2 は何も検査していないときに PASS と区別するための値。引数が不正なとき（未知の値・
#    2つ以上）と、`10` の単独実行で廃止一覧が無い／読めないときに返す）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

# 冒頭コメントの「使い方」節と「終了コード」節をそのまま表示する（記述を二重に持たない）
usage() {
  sed -n '/^# 使い方:/,/^# 除外設定:/{/^# 除外設定:/!p;}' "${SCRIPT_PATH}" | sed 's/^# \{0,1\}//'
  sed -n '/^# 終了コード:/,/^$/p' "${SCRIPT_PATH}" | sed 's/^# \{0,1\}//'
}

# 引数は「項目番号 1〜11 を1つ」か「なし」だけを受ける。
# それ以外（例: 対象ディレクトリのつもりの `.`）を黙って受けると、どの項目にも一致せず
# 何も検査しないまま PASS を返してしまうため、検査を始める前に止める（exit 2 = 未検査）。
case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "ERROR: 引数は項目番号を1つだけ指定できる（受け取った数: $#）。検査は実行していない" >&2
  usage >&2
  exit 2
fi
case "${1:-}" in
  ''|1|2|3|4|5|6|7|8|9|10|11|isr) ;;
  *)
    echo "ERROR: 未知の引数: '${1}'（項目番号 1〜11 または isr を指定する。対象リポジトリは AIDOC_ROOT で渡す）。検査は実行していない" >&2
    usage >&2
    exit 2
    ;;
esac
# 既定は「スクリプトの1つ上」= 自リポジトリのルート。
# AIDOC_ROOT を指定すると、任意のリポジトリを対象に検証できる（横断検証用）。
if [ -n "${AIDOC_ROOT:-}" ]; then
  ROOT_DIR="$(cd "${AIDOC_ROOT}" && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
cd "${ROOT_DIR}" || exit 1

ONLY="${1:-}"
STRICT="${AIDOC_STRICT:-0}"


# ISR の決定的診断。既存の任意PyYAMLを安全に再利用し、不在は未実施にする。
# 通常の項目1〜11とは別の出口を持ち、機械検証だけで ISR PASS を表示しない。
if [ "${ONLY}" = "isr" ]; then
  echo "INDEPENDENT_REVIEW: NOT_RUN"
  echo "HUMAN_APPROVAL: NOT_REQUESTED"
  echo "INVOCATION: NOT_RUN_SEPARATE_REQUIRED"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ISR_DIAGNOSTIC: NOT_RUN (Python 3なし)"
    exit 2
  fi
  python3 -I - "${ROOT_DIR}" "${AIDOC_ISR_MANIFEST:-}" <<'PYISR'
import csv
from datetime import date
import hashlib
from itertools import combinations
import json
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
manifest_path = sys.argv[2]
failed = []
not_run = []
unapplied_findings = []
source = None
# スキルの frontmatter のキー（正本: .claude/docs/frontmatter-policy.md §3.1）。
# 必須は従来の 6 キー。受け付けるのは、公式のスキル項目と管理用の 3 キー。それ以外の最上位のキーは違反にする。
SKILL_REQUIRED_KEYS = {'name', 'description', 'allowed-tools', 'version', 'updated', 'execution_type'}
# 公式の項目: code.claude.com/docs/en/skills の Frontmatter reference（2026-11-11 に原文で確認した 20 個）。
OFFICIAL_SKILL_KEYS = {'name', 'description', 'when_to_use', 'argument-hint', 'arguments',
                       'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools',
                       'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
                       'metadata', 'license', 'compatibility'}
# 管理用のキー: 版・更新日・実行構造の管理に使う（公式には無い）。
MANAGEMENT_SKILL_KEYS = {'version', 'updated', 'execution_type'}
SKILL_KEYS = OFFICIAL_SKILL_KEYS | MANAGEMENT_SKILL_KEYS
# allowed-tools で受け付ける名前: 公式のツール一覧（code.claude.com/docs/en/tools-reference の表。同日に確認した 46 個）。
# MCP のツールは mcp__ で始まる名前で別に受け付ける。
TOOLS = {'Agent','Artifact','AskUserQuestion','Bash','CronCreate','CronDelete','CronList','Edit',
         'EndConversation','EnterPlanMode','EnterWorktree','ExitPlanMode','ExitWorktree','Glob','Grep',
         'ListAgents','ListMcpResourcesTool','LSP','Monitor','NotebookEdit','PowerShell','PushNotification',
         'Read','ReadMcpResourceTool','RemoteTrigger','ReportFindings','ScheduleWakeup','SendFeedback',
         'SendMessage','SendUserFile','ShareOnboardingGuide','Skill','SubagentHandback','TaskCreate',
         'TaskGet','TaskList','TaskOutput','TaskStop','TaskUpdate','TodoWrite','ToolSearch',
         'WaitForMcpServers','WebFetch','WebSearch','Workflow','Write'}
# 旧名（違反にして、現行名を案内する）。起動ツールは 2.1.63 で Task から Agent に改名された。
# スキルと文書の表記は Agent へ置き換え済みで、旧名は違反にする（2026-11-11 のオーナーの決定）。
LEGACY_TOOLS = {'Task': 'Agent'}
# 名前の前後で除く文字: 半角空白・タブ・改行。全角空白などは名前の一部として残し、未対応値にする
# （行を直接読む validate-structure.sh [j]・validate-agent-invocation.py と同じ。期待値の表は scripts/tests/fixtures-allowed-tools/cases.json）。
TOOL_NAME_PADDING = ' \t\r\n'

def split_tools(value):
    # カンマ区切りの allowed-tools を分ける。括弧の中のカンマ（Agent(worker, researcher) など）では区切らない。
    items, depth, current = [], 0, ''
    for char in value:
        if char == '(':
            depth += 1
        elif char == ')' and depth:
            depth -= 1
        if char == ',' and depth == 0:
            items.append(current.strip(TOOL_NAME_PADDING))
            current = ''
        else:
            current += char
    items.append(current.strip(TOOL_NAME_PADDING))
    return items

def balanced(item):
    # 括弧の対応が取れているか（開きより先に閉じが来ない。閉じ残しが無い）。個数の一致だけでは判定しない。
    depth = 0
    for char in item:
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                return False
    return depth == 0

def emit(tag, data):
    print(tag + ' ' + json.dumps(data, ensure_ascii=False, sort_keys=True))

def issue(path, message, incomplete=False, **details):
    finding = {'path':path,'reason':message,**details}
    if incomplete:
        not_run.append(finding)
    elif not manifest_path:
        # 在庫の既知事実は残すが、対象・変更種別未指定の観測を適用済み違反にしない。
        unapplied_findings.append({**finding,'application':'not_applied'})
    else:
        failed.append(finding)

# -I は対象cwd/PYTHONPATH/user siteのyaml.pyをimport経路から外す。
try:
    import yaml
except ImportError:
    emit('ISR_NOT_RUN',{'path':None,'reason':'既存の任意PyYAMLなし。解析未実施（自動導入しない）'})
    emit('ISR_SUMMARY',{'status':'NOT_RUN','violations':0,'not_run':1,'unapplied_findings':0,
                        'targets':0,'source':None,'independent_review':'not_run','human_approval':'not_requested'})
    sys.exit(2)

class InvalidFrontmatter(ValueError):
    """読取・decode済みの既知の形式不正。"""

class UnsupportedFrontmatter(Exception):
    """安全な既存parserで解釈できない構文・タグ。"""

def yaml_type(value):
    if value is None: return 'null'
    if isinstance(value,str): return 'string'
    if isinstance(value,bool): return 'boolean'
    if isinstance(value,(int,float)): return 'number'
    if isinstance(value,list): return 'list'
    if isinstance(value,dict): return 'mapping'
    if type(value) is date: return 'date'
    return type(value).__name__

def parse(path):
    raw = path.read_bytes()
    text = raw.decode('utf-8-sig').replace('\r\n','\n').replace('\r','\n')
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip('\n') != '---':
        raise InvalidFrontmatter('frontmatter開始なし')
    end = next((i for i in range(1,len(lines)) if lines[i].rstrip('\n') == '---'), None)
    if end is None:
        raise InvalidFrontmatter('frontmatter終端なし')
    fm = ''.join(lines[1:end])
    duplicates, states, layouts = [], {}, {}
    loader = None
    try:
        loader = yaml.SafeLoader(fm)
        node = loader.get_single_node()
        if node is None:
            values = {}
        elif not isinstance(node,yaml.MappingNode):
            raise InvalidFrontmatter('frontmatterはmappingが必須')
        else:
            seen = set()
            for key_node,value_node in node.value:
                if key_node.tag == 'tag:yaml.org,2002:merge':
                    raise UnsupportedFrontmatter('frontmatterのmerge keyは未対応')
                if not isinstance(key_node,yaml.ScalarNode) or key_node.tag != 'tag:yaml.org,2002:str':
                    raise InvalidFrontmatter('frontmatterキーは文字列が必須')
                key = loader.construct_object(key_node,deep=True)
                if key in seen:
                    duplicates.append(key)
                seen.add(key)
                # YAML nullでも、値の無記入と明示nullを別の観測として残す。
                if isinstance(value_node,yaml.ScalarNode) and value_node.tag == 'tag:yaml.org,2002:null':
                    states[key] = 'empty' if value_node.value == '' else 'null'
                # 値を 1 行に書いているか。キーと同じ行で始まり、同じ行で終わる値だけを 1 行とする（| と > のブロックは複数行）。
                if isinstance(value_node,yaml.ScalarNode) and (value_node.style in ('|','>')
                        or value_node.start_mark.line != key_node.start_mark.line
                        or value_node.end_mark.line != value_node.start_mark.line):
                    layouts[key] = 'multiline'
            values = loader.construct_document(node)
    except yaml.constructor.ConstructorError as error:
        raise UnsupportedFrontmatter('安全なYAML parserの未対応タグ: ' + str(error)) from error
    except (yaml.YAMLError,ValueError,TypeError,OverflowError) as error:
        raise InvalidFrontmatter('YAML形式不正: ' + str(error)) from error
    except RecursionError as error:
        raise UnsupportedFrontmatter('YAMLの再帰構造を測定できない') from error
    finally:
        if loader is not None:
            loader.dispose()
    description = values.get('description')
    if isinstance(description,str):
        description = description.strip()
        values['description'] = description
        keywords = re.findall(r'「([^」]+)」',description)
    else:
        keywords = []
    # 旧リスト（triggers・autoTrigger）の読取は、非標準キーの禁止を解除しない。本文の例は解析対象外。
    for key in ('triggers','autoTrigger'):
        legacy = values.get(key)
        if isinstance(legacy,list):
            keywords.extend(word for word in legacy if isinstance(word,str))
    return values, ''.join(lines[end+1:]), keywords, raw, duplicates, len(fm), states, layouts

def kind(path):
    if path.name == 'SKILL.md':
        return 'skill'
    relative = path.relative_to(root).as_posix()
    if relative.startswith('.claude/agents/') and path.name not in ('README.md','COMPANY-VALUES.md','AGENTS.md'):
        return 'agent'
    if re.search(r'/skills/[^/]+/agents/[^/]+\.md$', relative):
        return 'material'
    if relative.startswith('.workflows/') and path.suffix == '.md':
        return 'workflow'
    return 'document'

def resolve(relative):
    if not isinstance(relative,str) or not relative:
        raise ValueError('対象pathが空または文字列でない')
    path = root / relative
    if Path(relative).is_absolute() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('対象pathはroot内の相対pathで指定する')
    if not path.is_file():
        raise ValueError('対象ファイルなし: ' + relative)
    return path

entries = []
if manifest_path:
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
        source = manifest['source']
        entries = manifest['files']
        if not isinstance(source,str) or not source.strip() or not isinstance(entries,list) or not entries:
            raise ValueError('source識別と非空files配列が必須')
        seen = set()
        for entry in entries:
            if not isinstance(entry,dict) or entry.get('change') not in ('new','full','partial'):
                raise ValueError('各files要素にpathとchange(new/full/partial)が必須')
            path = resolve(entry.get('path'))
            if path in seen:
                raise ValueError('対象path重複')
            seen.add(path)
    except (OSError,UnicodeError,ValueError,KeyError,TypeError) as error:
        issue(None,'manifest未実施: ' + str(error),True)
        entries = []
else:
    issue(None,'変更種別manifestなし。本文合否と増分は未実施（在庫の計測のみ）',True)
    paths = set(root.glob('.claude/skills/*/SKILL.md'))
    paths.update(root.glob('.claude/skills/*/agents/*.md'))
    paths.update(root.glob('.claude/agents/**/*.md'))
    paths.update(root.glob('.workflows/*.md'))
    entries = [{'path':str(path.relative_to(root)),'change':None} for path in sorted(paths)
               if kind(path) != 'document']

# 比較母集団は現在位置の正本スキル。template/wrapperを別スキルとして二重計上しない。
categories = {}
classification = root/'scripts/skill-classification.csv'
index = root/'.claude/docs/skill-reference.md'
try:
    if classification.is_file():
        with classification.open(encoding='utf-8',newline='') as stream:
            for row in csv.DictReader(stream):
                if row.get('name') and row.get('category'):
                    categories[row['name']] = (row['category'],'classification')
    if index.is_file():
        section, fence = None, False
        for line in index.read_text(encoding='utf-8').splitlines():
            if line.lstrip().startswith('```'):
                fence = not fence
                continue
            if fence:
                continue
            if re.match(r'^#{2,}\s',line):
                section = line.lstrip('#').strip()
            if section:
                names = re.findall(r'\.claude/skills/([a-z0-9-]+)/SKILL\.md',line)
                names += re.findall(r'^[-*]\s+`([a-z0-9-]+)`\s+(?:—|-)(?:\s|$)',line)
                for name in names:
                    categories.setdefault(name,(section,'index'))
except (OSError,UnicodeError,csv.Error) as error:
    issue(None,'domain分類未確認: ' + str(error),True)

population = {}
population_incomplete = {}
for path in sorted(root.glob('.claude/skills/*/SKILL.md')):
    try:
        values,_,keywords,_,_,_,_,_ = parse(path)
        if isinstance(values.get('description'),str):
            population[path.parent.name] = set(keywords)
        else:
            population_incomplete[str(path.relative_to(root))] = 'descriptionが文字列でなくkeyword未測定'
    except (OSError,UnicodeError,ValueError,UnsupportedFrontmatter) as error:
        population_incomplete[str(path.relative_to(root))] = str(error)

for entry in entries:
    relative = entry['path']
    try:
        path = resolve(relative)
        target_kind = kind(path)
        raw = path.read_bytes()
        observation = {'path':relative,'source':source,'sha256':hashlib.sha256(raw).hexdigest(),
                       'type':target_kind,'change':entry['change'],'independent_review':'not_run',
                       'size_status':'not_applicable','body_delta':None,'distribution_links':'independent_judgement_required'}
        if target_kind != 'document':
            values,body,keywords,raw,duplicates,fm_chars,value_states,layouts = parse(path)
            name = values.get('name')
            description = values.get('description')
            sentence = None
            if isinstance(description,str):
                sentence = description.split('。',1)[0] + ('。' if '。' in description else '')
                sentence = sentence.replace('\n','')
            observation.update(frontmatter_status='parsed',
                               name_chars=len(name) if isinstance(name,str) else None,body_chars=len(body),
                               keywords=keywords if isinstance(description,str) else None,
                               description_type=yaml_type(description) if 'description' in values else 'missing',
                               description_value=description if isinstance(description,str) else None,
                               description_chars=len(description) if isinstance(description,str) else None,
                               first_sentence_chars=len(sentence) if sentence is not None else None,
                               frontmatter_chars=fm_chars,references=[],size_status='not_applicable')
            required = {'name','description'}
            if target_kind == 'skill':
                required = SKILL_REQUIRED_KEYS
            elif target_kind == 'agent':
                required |= {'tools'}
            elif target_kind == 'workflow':
                required |= {'version','updated'}
            for key in required:
                value = values.get(key)
                if key not in values:
                    issue(relative,'必須値なし: ' + key,field=key,value_state='missing')
                elif value is None:
                    issue(relative,'必須値なし: ' + key,field=key,value_state=value_states.get(key,'null'),actual_type='null')
                elif not isinstance(value,str) and not (key=='updated' and type(value) is date):
                    issue(relative,'必須値の型不正: ' + key,field=key,value_state='invalid_type',actual_type=yaml_type(value))
                elif isinstance(value,str) and not value.strip():
                    issue(relative,'必須値なし: ' + key,field=key,value_state='empty',actual_type='string')
            for key in duplicates:
                issue(relative,'frontmatterキー重複: ' + key)
            if isinstance(name,str) and (not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',name) or len(name)>64):
                issue(relative,'name形式/64字上限')
            if target_kind == 'skill' and isinstance(name,str) and name != path.parent.name:
                issue(relative,'nameとディレクトリ名不一致')
            if target_kind in ('agent','material') and isinstance(name,str) and name != path.stem:
                issue(relative,'nameとファイル名不一致')
            if target_kind in ('skill','workflow'):
                version = values.get('version')
                if isinstance(version,str) and not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?',version):
                    issue(relative,'versionのsemver形式')
                try:
                    updated = values.get('updated')
                    if type(updated) is not date:
                        if not isinstance(updated,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',updated):
                            raise ValueError('YYYY-MM-DD必須')
                        date.fromisoformat(updated)
                except ValueError:
                    issue(relative,'updatedの日付形式/暦')
            if target_kind == 'skill':
                for key in sorted(values.keys() - SKILL_KEYS, key=str):
                    issue(relative,'非標準frontmatterキー: ' + str(key))
                tools_value = values.get('allowed-tools')
                # 1 行に書いた値だけを受け付ける。行を直接読む検査器 2 本（validate-structure.sh [j]・
                # validate-agent-invocation.py）は、複数行の値を読めない（YAML として正しくても、同じ値を見られない）。
                if isinstance(tools_value,str) and layouts.get('allowed-tools') == 'multiline':
                    issue(relative,'allowed-toolsは1行で書く')
                tools = split_tools(tools_value) if isinstance(tools_value,str) else []
                for tool in tools:
                    # 括弧の対応が取れない値は解析できない。後ろの名前の検査が抜けるので、正常として通さない。
                    if not balanced(tool):
                        issue(relative,'allowed-toolsの括弧不整合: ' + tool)
                        continue
                    # 括弧の前の名前で判定する。括弧の前の空白（Agent (worker)）は名前に含めない。
                    base = tool.split('(',1)[0].strip(TOOL_NAME_PADDING)
                    if base in LEGACY_TOOLS:
                        issue(relative,'allowed-toolsの旧名: ' + tool + '（' + LEGACY_TOOLS[base] + ' と書く）')
                    elif base not in TOOLS and not re.fullmatch(r'mcp__[A-Za-z0-9_*-]+',base):
                        issue(relative,'allowed-toolsの未対応値: ' + tool)
                execution_type = values.get('execution_type')
                if execution_type not in ('standalone','agent-teams','subagent','hybrid'):
                    issue(relative,'execution_typeの値域')
                if execution_type == 'standalone' and any((path.parent/'agents').glob('*.md')):
                    issue(relative,'standaloneにagents/素材が存在')
                # 先頭位置・記述形は情報級。新規/全面でも合否に数えず独立判断へ渡す。
                observation['description_form_review_required'] = (not keywords or len(sentence)>40 or description.startswith(('【','「','『','['))) if isinstance(description,str) else None
                if entry['change'] in ('new','full'):
                    observation['size_status'] = 'within_limit' if len(body)<=5500 else 'over_limit'
                    if len(body)>5500:
                        issue(relative,'本文5500字超過（新規/全面）')
                elif entry['change'] == 'partial':
                    observation['size_status'] = 'not_run'
                    try:
                        before = resolve(entry.get('before'))
                        _,old_body,_,old_raw,_,_,_,_ = parse(before)
                        observation.update(body_delta=len(body)-len(old_body),before_sha256=hashlib.sha256(old_raw).hexdigest(),
                                           size_status='increment_review_required')
                    except (OSError,UnicodeError,ValueError,UnsupportedFrontmatter) as error:
                        issue(relative,'部分変更のbefore未確認: ' + str(error),True)
                else:
                    observation['size_status'] = 'not_run'
                for reference in sorted(path.parent.glob('reference*.md')):
                    count = len(reference.read_text(encoding='utf-8').splitlines())
                    observation['references'].append({'path':str(reference.relative_to(root)),'lines':count,'over_100_advisory':count>100})
        emit('ISR_OBSERVATION',observation)
    except InvalidFrontmatter as error:
        issue(relative,'既知frontmatter形式不正: ' + str(error),format_status='invalid')
        observation.update(frontmatter_status='invalid',name_chars=None,description_chars=None,
                           first_sentence_chars=None,body_chars=None,keywords=None,size_status='not_run')
        emit('ISR_OBSERVATION',observation)
    except (OSError,UnicodeError,ValueError,TypeError,UnsupportedFrontmatter) as error:
        issue(relative,'対象診断未実施: ' + str(error),True)

# 対象内は上の型/形式/未読判定へ一本化。対象外母集団の抽出不能も衝突なしにはしない。
selected = {entry['path'] for entry in entries}
for relative,reason in population_incomplete.items():
    if relative not in selected:
        issue(relative,'keyword母集団未確認: ' + reason,True)

keywords_all = sorted(set().union(*population.values()) if population else set())
for keyword in keywords_all:
    names = sorted(name for name,words in population.items() if keyword in words)
    if len(names)<2:
        continue
    # 異domainを含む集合でも、その中の同domainペアを隠さない。
    for pair in combinations(names,2):
        domains = {name:categories.get(name,(None,None))[0] for name in pair}
        if any(value is None for value in domains.values()):
            relation = 'unknown_domain'
        elif len(set(domains.values())) == 1:
            relation = 'same_domain_candidate'
        else:
            relation = 'cross_domain_candidate'
        emit('ISR_KEYWORD_OVERLAP',{'keyword':keyword,'skills':list(pair),'domains':domains,
                                   'domain_sources':{name:categories.get(name,(None,None))[1] for name in pair},
                                   'domain_relation':relation,'semantic_conflict':None})
for item in failed:
    emit('ISR_VIOLATION',item)
for item in not_run:
    emit('ISR_NOT_RUN',item)
for item in unapplied_findings:
    emit('ISR_UNAPPLIED_FINDING',item)
status = 'FAIL' if failed else ('NOT_RUN' if not_run else 'COMPLETE')
emit('ISR_SUMMARY',{'status':status,'violations':len(failed),'not_run':len(not_run),'unapplied_findings':len(unapplied_findings),
                    'targets':len(entries),'source':source,'independent_review':'not_run','human_approval':'not_requested',
                    'separate_required':['current_links','wrapper_sync','agent_invocation'],
                    'metadata_tokens':'advisory_not_measured','semantic_keywords':'independent_judgement_required'})
sys.exit(1 if failed else (2 if not_run else 0))
PYISR
  exit "$?"
fi

VIOLATIONS=()
WARNINGS=()
IGNORED=0

# .aidocignore に載っている指摘は抑止する
is_ignored() {
  [ -f .aidocignore ] || return 1
  # パターンを先に全行取り出し、grep -f で「どれか1行に一致したら抑止」と判定する。
  # （while ループの終了コードは最後の行の照合結果になり、pipefail の下では
  #   最後の行以外のパターンが効かなかった）
  local pats
  pats="$(grep -v '^[ \t]*#' .aidocignore 2>/dev/null | grep -v '^[ \t]*$')"
  [ -n "${pats}" ] || return 1
  grep -q -f <(printf '%s\n' "${pats}") <<< "$1"
}

add_v() { if is_ignored "$1"; then IGNORED=$((IGNORED + 1)); else VIOLATIONS+=("$1"); fi; }
add_w() { if is_ignored "$1"; then IGNORED=$((IGNORED + 1)); else WARNINGS+=("$1"); fi; }
run_check() { [ -z "${ONLY}" ] || [ "${ONLY}" = "$1" ]; }

# 件数を1行にまとめて出す WARN（[3w]・[4b]・[5b]・[6w]）の集計。
#   $1 = 1行1指摘のファイル / $2 = 一覧表示するか（1 で一覧）/ $3 = まとめ行の書式（%s に件数）
# `.aidocignore` は1指摘ずつ照合し、抑止した分は件数に入れず IGNORED に数える。
# （まとめた1行だけを照合すると、抑止前の件数が WARN に出て ignored= が 0 のままになる）
# まとめ行も add_w を通すので、まとめ行そのものに当てた既存の抑止パターンも従来どおり効く。
add_w_bulk() {
  local src="$1" list="$2" fmt="$3" kept="${1}.kept" line n
  : > "$kept"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if is_ignored "$line"; then IGNORED=$((IGNORED + 1)); else printf '%s\n' "$line" >> "$kept"; fi
  done < "$src"
  n=$(wc -l < "$kept" | tr -d ' ')
  if [ "$n" -gt 0 ]; then
    if [ "$list" = "1" ]; then
      while IFS= read -r line; do WARNINGS+=("$line"); done < "$kept"
    else
      # shellcheck disable=SC2059  # 書式はこのスクリプト内の固定文字列だけを渡す
      add_w "$(printf "$fmt" "$n")"
    fi
  fi
  rm -f "$kept"
}

echo "=== validate-ai-docs.sh :: ${ROOT_DIR} ==="

# ------------------------------------------------------------------
# [1][2] SKILL.md frontmatter / name 一致
# ------------------------------------------------------------------
if run_check 1 || run_check 2; then
  for f in .claude/skills/*/SKILL.md; do
    [ -e "$f" ] || continue
    dir_name="$(basename "$(dirname "$f")")"
    if ! head -1 "$f" | grep -q '^---'; then
      add_v "[1] frontmatter なし: $f"
      continue
    fi
    fm="$(sed -n '2,/^---$/p' "$f")"
    echo "$fm" | grep -q '^name:' || add_v "[1] name: なし: $f"
    echo "$fm" | grep -q '^description:' || add_v "[1] description: なし: $f"
    fm_name="$(echo "$fm" | grep '^name:' | head -1 | sed 's/^name: *//' | tr -d '"'"'"' \r')"
    if [ -n "$fm_name" ] && [ "$fm_name" != "$dir_name" ]; then
      add_v "[2] name とディレクトリ名の不一致: $f (name=$fm_name / dir=$dir_name)"
    fi
  done
fi

# ------------------------------------------------------------------
# [3] エージェント定義の frontmatter
# ------------------------------------------------------------------
if run_check 3; then
  if [ -d .claude/agents ]; then
    find .claude/agents -name '*.md' ! -iname 'README.md' ! -iname 'COMPANY-VALUES.md' -print | while read -r f; do
      if ! head -1 "$f" | grep -q '^---'; then
        echo "VIOLATION|[3] frontmatter なし: $f"
        continue
      fi
      fm="$(sed -n '2,/^---$/p' "$f")"
      echo "$fm" | grep -q '^name:' || echo "VIOLATION|[3] name: なし: $f"
      echo "$fm" | grep -q '^description:' || echo "VIOLATION|[3] description: なし: $f"
      fm_name="$(echo "$fm" | grep '^name:' | head -1 | sed 's/^name: *//' | tr -d '\"'"'"' \r')"
      base_name="$(basename "$f" .md)"
      if [ -n "$fm_name" ] && [ "$fm_name" != "$base_name" ]; then
        echo "VIOLATION|[3b] name とファイル名の不一致: $f (name=$fm_name / file=$base_name)"
      fi
      # [3w] model: が無い、または値が空（`model:`・`model: # inherit` のようにコメントだけ・
      # `model: ""`・`model: ''`）。どれも YAML では値なしと同じで、環境既定 CLAUDE_CODE_SUBAGENT_MODEL の
      # 段へ進むため、親継承でも `model: inherit` と書く（frontmatter-policy.md §2）。WARN 止まり。
      # 値は「行頭の # 以降・空白に続く # 以降を捨て、前後の空白と対になった引用符を外す」で取り出す。
      model_val="$(echo "$fm" | grep '^model:' | head -1 \
        | sed -e 's/^model:[[:space:]]*//' -e 's/^#.*$//' -e 's/[[:space:]]#.*$//' \
              -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/" \
              -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      [ -n "$model_val" ] || echo "WARNING|[3w] model: なし: $f"
    done > /tmp/aidoc_agents_$$.txt
    : > /tmp/aidoc_agents_w_$$.txt
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in
        WARNING\|*) printf '%s\n' "${line#WARNING|}" >> /tmp/aidoc_agents_w_$$.txt ;;
        *) add_v "${line#VIOLATION|}" ;;
      esac
    done < /tmp/aidoc_agents_$$.txt
    add_w_bulk /tmp/aidoc_agents_w_$$.txt "${AIDOC_LIST_MODEL:-0}" \
      "[3w] model: 行の無いエージェント定義 %s 件（親継承でも model: inherit と書く。AIDOC_LIST_MODEL=1 で一覧表示）"
    rm -f /tmp/aidoc_agents_$$.txt /tmp/aidoc_agents_w_$$.txt
  fi
fi

# ------------------------------------------------------------------
# [4] リンク切れ（AI ドキュメントが参照するリポジトリ内パス）
# ------------------------------------------------------------------
if run_check 4; then
  DOCS_LIST="/tmp/aidoc_docs_$$.txt"
  : > "$DOCS_LIST"
  for f in CLAUDE.md AGENTS.md README.md DESIGN.md; do
    [ -e "$f" ] && echo "$f" >> "$DOCS_LIST"
  done
  for d in .claude/rules .claude/docs .claude/skills .claude/agents; do
    [ -d "$d" ] && find "$d" -name '*.md' -print >> "$DOCS_LIST"
  done

  LINKS="/tmp/aidoc_links_$$.txt"
  : > "$LINKS"
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    base_dir="$(dirname "$f")"
    # Markdown リンク [text](path) を抽出
    #   除外: コードブロック内 / http(s) / mailto / アンカーのみ /
    #         プレースホルダを含むパス（{...}） / 説明用の省略記号（...）
    # 同じ行内で同じ長さのバッククォート列が閉じたコードだけを除く。
    # 開き側は直前の backslash が奇数ならエスケープ。コード内の backslash は文字のまま。
    awk '
      function without_code(text, out, pos, after, size, scan, finish, close_at, back, slashes) {
        if (!index(text, "`")) return text
        out = ""
        pos = 1
        while (pos <= length(text)) {
          if (substr(text, pos, 1) != "`") {
            out = out substr(text, pos++, 1)
            continue
          }
          slashes = 0
          for (back = pos - 1; back > 0 && substr(text, back, 1) == "\\"; back--) slashes++
          if (slashes % 2) {
            out = out substr(text, pos++, 1)
            continue
          }
          after = pos + 1
          while (substr(text, after, 1) == "`") after++
          size = after - pos
          close_at = 0
          scan = after
          while (scan <= length(text)) {
            if (substr(text, scan, 1) != "`") { scan++; continue }
            finish = scan + 1
            while (substr(text, finish, 1) == "`") finish++
            if (finish - scan == size) { close_at = finish; break }
            scan = finish
          }
          if (close_at) pos = close_at
          else {
            out = out substr(text, pos, size)
            pos = after
          }
        }
        return out
      }
      /^[ \t]*```/ { inblock = !inblock; next }
      !inblock { print without_code($0) }
    ' "$f" 2>/dev/null \
      | grep -o '](\([^)]*\))' \
      | sed 's/^](//; s/)$//' \
      | sed 's/#.*$//' \
      | grep -v '^https\{0,1\}:' \
      | grep -v '^mailto:' \
      | grep -v '{' \
      | grep -v '^\.\{2,\}$' \
      | grep -v '^$' \
      | while IFS= read -r p; do
          echo "${f}|${base_dir}|${p}"
        done >> "$LINKS"
  done < "$DOCS_LIST"

  while IFS='|' read -r src base p; do
    [ -z "$p" ] && continue
    case "$p" in
      /*) target="${ROOT_DIR}${p}" ;;
      ./*|../*) target="${base}/${p}" ;;
      *) target="${base}/${p}" ;;
    esac
    # ルート相対の慣用表記（.claude/... など）も許容してフォールバック判定する
    if [ ! -e "$target" ] && [ ! -e "$p" ]; then
      add_v "[4] リンク切れ: ${src} -> ${p}"
    fi
  done < "$LINKS"

  # [4b] バッククォート表記のリポジトリ内パス（`.claude/skills/foo/SKILL.md` 等）。
  # Markdown リンクではないため [4] では拾えないが、スキル索引・関連スキル表はこの形式が多く、
  # 刈り込み後に大量の死に参照が残る主要な温床になる。
  # 汎用的な例示にも同じ書式が使われるため WARN 止まりとし、AIDOC_LIST_BT=1 で一覧表示する。
  # 接頭辞に .workflows/ を含める（拠点の CLAUDE.md・スキルが `.workflows/*.md` を指したまま、
  # 拠点に .workflows/ が無いと死に参照になるため。工程正本 development-flow.md 新設時に追加）。
  BT="/tmp/aidoc_bt_$$.txt"
  : > "$BT"
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    awk '/^[ \t]*```/ { inblock = !inblock; next } !inblock { print }' "$f" 2>/dev/null \
      | grep -o '`[.a-zA-Z0-9_/-]*`' \
      | tr -d '`' \
      | grep '^\(\.claude/\|\.agents/\|\.docs/\|\.workflows/\|templates/\|scripts/\|docs/\)' \
      | grep '\.\(md\|sh\|py\|js\|ts\)$' \
      | while IFS= read -r p; do
          [ -e "$p" ] || echo "[4b] バッククォート参照が実在しない: ${f} -> ${p}"
        done >> "$BT"
  done < "$DOCS_LIST"
  if [ -s "$BT" ]; then
    sort -u "$BT" > "${BT}.u"
    add_w_bulk "${BT}.u" "${AIDOC_LIST_BT:-0}" \
      "[4b] バッククォート表記の死に参照 %s 件（AIDOC_LIST_BT=1 で一覧表示）"
    rm -f "${BT}.u"
  fi
  rm -f "$BT"
  rm -f "$DOCS_LIST" "$LINKS"
fi

# ------------------------------------------------------------------
# [5] 未置換プレースホルダ
# ------------------------------------------------------------------
if run_check 5; then
  for f in CLAUDE.md AGENTS.md README.md DESIGN.md; do
    [ -e "$f" ] || continue
    awk '/^[ \t]*```/ { inblock = !inblock; next } !inblock { printf "%d:%s\n", NR, $0 }' "$f" \
      | grep '{[A-Z][A-Z0-9_]*}' \
      | while IFS= read -r line; do
          echo "[5] 未置換プレースホルダの疑い: ${f}:${line}"
        done >> /tmp/aidoc_ph_$$.txt
  done
  if [ -f /tmp/aidoc_ph_$$.txt ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      add_v "$line"
    done < /tmp/aidoc_ph_$$.txt
    rm -f /tmp/aidoc_ph_$$.txt
  fi

  # [5b] スキル・ドキュメント本文の未置換プレースホルダ。
  # 汎用的な例示として意図的に残す場合があるため WARN 止まり。
  # 配布先では「配備時にローカライズし損ねた箇所」である可能性が高く、必ず一件ずつ判定すること。
  for d in .claude/skills .claude/docs .claude/rules; do
    [ -d "$d" ] || continue
    find "$d" -name '*.md' -print 2>/dev/null | while IFS= read -r f; do
      awk '/^[ \t]*```/ { inblock = !inblock; next } !inblock { printf "%d\n", NR }' "$f" > /tmp/aidoc_ok_$$.txt
      awk -v OKF=/tmp/aidoc_ok_$$.txt -v FNAME="$f" '
        BEGIN { while ((getline l < OKF) > 0) ok[l] = 1 }
        (NR in ok) && /{[A-Z][A-Z0-9_]*}/ { printf "[5b] スキル/ドキュメント内の未置換プレースホルダ: %s:%d\n", FNAME, NR }
      ' "$f"
      rm -f /tmp/aidoc_ok_$$.txt
    done >> /tmp/aidoc_ph2_$$.txt
  done
  if [ -f /tmp/aidoc_ph2_$$.txt ]; then
    add_w_bulk /tmp/aidoc_ph2_$$.txt "${AIDOC_LIST_PH:-0}" \
      "[5b] .claude/skills|docs|rules 配下の未置換プレースホルダ %s 件（AIDOC_LIST_PH=1 で一覧表示）"
    rm -f /tmp/aidoc_ph2_$$.txt
  fi
fi

# ------------------------------------------------------------------
# [6] ファイル名・ディレクトリ名の多バイト文字
# ------------------------------------------------------------------
if run_check 6; then
  # AI 基盤（.claude / .agents）配下は命名規則を厳守 → FAIL
  for d in .claude .agents; do
    [ -d "$d" ] || continue
    find "$d" -print 2>/dev/null | LC_ALL=C grep '[^ -~]' | while IFS= read -r p; do
      echo "[6] ファイル名に多バイト文字: $p"
    done >> /tmp/aidoc_mb_$$.txt
  done
  if [ -f /tmp/aidoc_mb_$$.txt ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      add_v "$line"
    done < /tmp/aidoc_mb_$$.txt
    rm -f /tmp/aidoc_mb_$$.txt
  fi
  # 業務成果物（.docs / docs）は日付・和文タイトルを含む運用が実在するため WARN 止まり。
  # 命名規則の適用対象は「リポジトリ運用上のファイル」であり、成果物ファイルは対象外
  #（.claude/rules/naming-conventions.md の適用範囲を参照）。
  for d in .docs docs; do
    [ -d "$d" ] || continue
    find "$d" -print 2>/dev/null | LC_ALL=C grep '[^ -~]' | while IFS= read -r p; do
      echo "[6w] 成果物ファイル名に多バイト文字（運用判断）: $p"
    done >> /tmp/aidoc_mbw_$$.txt
  done
  if [ -f /tmp/aidoc_mbw_$$.txt ]; then
    # 一覧表示時は他の項目と同じく個別行だけを出す（まとめ行と個別行を二重に数えない）
    add_w_bulk /tmp/aidoc_mbw_$$.txt "${AIDOC_LIST_MBW:-0}" \
      "[6w] .docs/ 配下の多バイトファイル名 %s 件（成果物のため既定では違反としない。詳細は AIDOC_LIST_MBW=1 で表示）"
    rm -f /tmp/aidoc_mbw_$$.txt
  fi
fi

# ------------------------------------------------------------------
# [7] Markdown テーブルの列数一致
# ------------------------------------------------------------------
if run_check 7; then
  find .claude -name '*.md' -print 2>/dev/null > /tmp/aidoc_tbl_$$.txt
  for f in CLAUDE.md AGENTS.md README.md DESIGN.md; do
    [ -e "$f" ] && echo "$f" >> /tmp/aidoc_tbl_$$.txt
  done
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    # 見出し行は区切り行の直前の行だけ。表でない行・コードフェンスで直前の列数を捨てる
    # （捨てないと、見出しが空セルの表 `| | |` で前の別の表の列数を見出しとして比べてしまう）。
    # 区切り行は `-` を1つ以上含む行に限る（`| | |` は空セルの見出し行であって区切り行ではない）。
    awk -v FNAME="$f" '
      /^```/ { inblock = !inblock; hdr = 0; prev_n = 0; next }
      inblock { next }
      {
        line = $0
        gsub(/\\\|/, "", line)
        if (line !~ /^[ \t]*\|/) { hdr = 0; prev_n = 0; next }
        n = gsub(/\|/, "|", line)
        if (line ~ /^[ \t]*\|[ \t:|-]*-[ \t:|-]*\|[ \t]*$/ && prev_n > 0) { hdr = 1; hdr_n = prev_n; next }
        if (hdr == 1 && n != hdr_n) {
          printf "[7] テーブル列数不一致: %s:%d (見出し %d 列 / データ %d 列)\n", FNAME, NR, hdr_n, n
        }
        prev_n = n
      }
    ' "$f" >> /tmp/aidoc_tblout_$$.txt
  done < /tmp/aidoc_tbl_$$.txt
  if [ -f /tmp/aidoc_tblout_$$.txt ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      add_w "$line"
    done < /tmp/aidoc_tblout_$$.txt
    rm -f /tmp/aidoc_tblout_$$.txt
  fi
  rm -f /tmp/aidoc_tbl_$$.txt
fi

# ------------------------------------------------------------------
# [8] frontmatter version と Version History の最大 semver 一致
# ------------------------------------------------------------------
if run_check 8; then
  for f in .claude/skills/*/SKILL.md; do
    [ -e "$f" ] || continue
    grep -q '^## Version History' "$f" || continue
    fm_ver="$(sed -n '2,/^---$/p' "$f" | grep '^version:' | head -1 | sed 's/^version: *//' | tr -d '"'"'"' \r')"
    [ -n "$fm_ver" ] || continue
    # 版のセルは太字（`| **v1.10.0** |`）も拾う（拾わないと太字の新しい版を見落とす）
    max_ver="$(sed -n '/^## Version History/,/^## /p' "$f" \
      | grep -o '| *\(\*\*\)\{0,1\}v\{0,1\}[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(\*\*\)\{0,1\} *|' \
      | tr -d '| v*' \
      | sort -t. -k1,1n -k2,2n -k3,3n \
      | tail -1)"
    if [ -n "$max_ver" ] && [ "$fm_ver" != "$max_ver" ]; then
      add_v "[8] version 不一致: $f (frontmatter=$fm_ver / VersionHistory 最大=$max_ver)"
    fi
  done
fi

# ------------------------------------------------------------------
# [9] ルート CLAUDE.md の存在
# ------------------------------------------------------------------
if run_check 9; then
  if [ ! -e CLAUDE.md ]; then
    if [ -e .claude/CLAUDE.md ]; then
      add_v "[9] ルート CLAUDE.md が無く .claude/CLAUDE.md のみ存在する。ルートへ移動（またはルートから参照）すること"
    else
      add_v "[9] CLAUDE.md が存在しない"
    fi
  fi
fi

# ------------------------------------------------------------------
# [10] 実体の無いスキル名の参照
# ------------------------------------------------------------------
# 廃止・統合で実体が無くなったスキル名が、本文に「生きた参照」として残っていないかを見る。
# [4]/[4b] はパスの実在しか見ないため、「`foo` スキルを使う」のような素の名前参照は素通りする。
#
# 設計上の約束（変更しないこと）:
#   - [1]〜[9] の VIOLATIONS / WARNINGS 配列と RESULT: 行には一切加算しない（別欄集計）。
#     終了コードに効くのは `bash scripts/validate-ai-docs.sh 10` の単独実行時のみ。
#   - AIDOC_STRICT=1 でも [10] は終了コードに影響させない。
#   - [4] と違いコードフェンス内も走査する（フェンス内の Skill(...) 例示も死に参照になるため）。
#   - OKF 予約の履歴ファイル log.md は WARN 範囲。`.claude/docs/log.md` と
#     その同期ミラー `templates/docs/log.md` の両方を同じ一覧（R10_OKF_LOGS）で扱い、
#     片方だけが FAIL 範囲に残る状態を作らない。
#   - 廃止一覧が読めない（＝何も検査できていない）ときは PASS と書かない。
#     RESULT[10]: SKIP を出し、`validate-ai-docs.sh 10` の単独実行では exit 2 で返す
#     （0 = 検査して問題なし / 1 = 検査して FAIL / 2 = 未検査 を終了コードで区別する）。
R10_RAN=0
R10_FAIL=()
R10_WARN=()
R10_SKIP=0      # 実体が在るため判定しなかったスキル名の件数（検査は行われている）
R10_NOLIST=0    # 1 = 廃止一覧が無い／読めないため [10] を検査していない（未検査）
R10_SELF=0
R10_IGNORED=0
R10_INFO=()

r10_add_f() { if is_ignored "$1"; then R10_IGNORED=$((R10_IGNORED + 1)); else R10_FAIL+=("$1"); fi; }
r10_add_w() { if is_ignored "$1"; then R10_IGNORED=$((R10_IGNORED + 1)); else R10_WARN+=("$1"); fi; }

# ERE のメタ文字になり得る "." だけ保護する（スキル名は kebab-case が前提）
r10_ere() { printf '%s' "$1" | sed 's/\./[.]/g'; }

# RESULT: 行の直前に [10] の集計行を出す（全項目実行時）。exit には影響させない。
r10_result_line() {
  [ "${R10_RAN}" = "1" ] || return 0
  if [ "${R10_NOLIST}" = "1" ]; then
    echo "RESULT[10]: SKIP (未検査: 廃止一覧が無い／読めない)  ※検査していないため PASS とは書かない"
  elif [ ${#R10_FAIL[@]} -gt 0 ]; then
    echo "RESULT[10]: FAIL (fail=${#R10_FAIL[@]})  ※別欄集計。下の RESULT: と終了コードには含めない"
  else
    echo "RESULT[10]: PASS (fail=0, warn=${#R10_WARN[@]}, skip=${R10_SKIP})"
  fi
}

if run_check 10; then
  R10_RAN=1
  BQ='`'

  # 一覧の解決順。AIDOC_RETIRED_LIST が指定されているのに存在しない場合は
  # 設定ミスを黙って通さないため、後続へフォールバックせず SKIP にする。
  # 読めない一覧（パーミッション等）も「一覧なし」と同じ未検査として扱う
  R10_LIST=""
  if [ -n "${AIDOC_RETIRED_LIST:-}" ]; then
    { [ -f "${AIDOC_RETIRED_LIST}" ] && [ -r "${AIDOC_RETIRED_LIST}" ]; } && R10_LIST="${AIDOC_RETIRED_LIST}"
  elif [ -f "${ROOT_DIR}/retired-skills.txt" ] && [ -r "${ROOT_DIR}/retired-skills.txt" ]; then
    R10_LIST="${ROOT_DIR}/retired-skills.txt"
  elif [ -f "${ROOT_DIR}/scripts/retired-skills.txt" ] && [ -r "${ROOT_DIR}/scripts/retired-skills.txt" ]; then
    R10_LIST="${ROOT_DIR}/scripts/retired-skills.txt"
  elif [ -f "${SCRIPT_DIR}/retired-skills.txt" ] && [ -r "${SCRIPT_DIR}/retired-skills.txt" ]; then
    # AIDOC_ROOT で拠点を検査する既定経路。cd "${ROOT_DIR}" 済みなので相対では書かない
    R10_LIST="${SCRIPT_DIR}/retired-skills.txt"
  fi

  if [ -z "${R10_LIST}" ]; then
    # 何も検査していない状態。PASS と書かず SKIP（未検査）として出す
    R10_NOLIST=1
    R10_INFO+=("[10] SKIP: 廃止一覧が無い／読めないため未検査（AIDOC_RETIRED_LIST か scripts/retired-skills.txt を置く）")
  else
    # FAIL 範囲: ルート4文書 ＋ .claude/{rules,docs,skills,agents} ＋ .agents ＋ templates（本体のみ）
    R10_F="/tmp/aidoc_r10f_$$.txt"
    R10_W="/tmp/aidoc_r10w_$$.txt"
    : > "$R10_F"
    : > "$R10_W"
    for f in CLAUDE.md AGENTS.md README.md DESIGN.md; do
      [ -e "$f" ] && echo "$f" >> "$R10_F"
    done
    for d in .claude/rules .claude/docs .claude/skills .claude/agents .agents templates; do
      [ -d "$d" ] && find "$d" -name .git -prune -o -name '*.md' -print >> "$R10_F"
    done
    # OKF 予約の履歴ファイル log.md は FAIL 範囲から外して WARN 範囲へ回す。
    # `.claude/docs/log.md` と `templates/docs/log.md` は skill-template-sync.md が
    # 定める双方向同期の対象で byte 一致のミラー。FAIL 範囲は templates も walk する
    # ため、片方だけ外すと廃止スキルを一覧へ足した瞬間にミラー側だけが FAIL になり、
    # かつ「log.md の履歴記述は書き換えない」という手順と両立しなくなる（ミラーだけを
    # 書き換えるのも同期規約が禁じる）。除外と WARN 追加を同じ一覧から作り、
    # 2 か所がずれないようにする。
    R10_OKF_LOGS=".claude/docs/log.md templates/docs/log.md"
    # `find .claude/docs ...` の出力は "./" を付けないが、find の起点表記が変わっても
    # 効くよう "./" 付きの表記も併記し、固定文字列の完全一致（-F -x）で除外する。
    R10_EXC="/tmp/aidoc_r10exc_$$.txt"
    : > "$R10_EXC"
    for p in $R10_OKF_LOGS; do
      printf '%s\n./%s\n' "$p" "$p" >> "$R10_EXC"
    done
    grep -v -x -F -f "$R10_EXC" "$R10_F" > "${R10_F}.k" 2>/dev/null
    mv "${R10_F}.k" "$R10_F" 2>/dev/null
    rm -f "$R10_EXC"

    # WARN 範囲: 業務成果物・履歴（[6w] と同じ「成果物は WARN 止まり」方針に合わせる）
    for d in .docs docs; do
      [ -d "$d" ] && find "$d" -name .git -prune -o -name '*.md' -print >> "$R10_W"
    done
    for p in $R10_OKF_LOGS; do
      [ -e "$p" ] && echo "$p" >> "$R10_W"
    done

    R10_WRAW="/tmp/aidoc_r10wraw_$$.txt"
    : > "$R10_WRAW"

    while IFS= read -r r10_line; do
      case "$r10_line" in ''|'#'*) continue ;; esac
      r10_name="$(printf '%s\n' "$r10_line" | awk -F'\t' '{print $1}')"
      r10_succ="$(printf '%s\n' "$r10_line" | awk -F'\t' '{print $3}')"
      [ -n "$r10_name" ] || continue
      [ -n "$r10_succ" ] && [ "$r10_succ" != "-" ] || r10_succ="なし"

      # 実在ガード: 拠点が刈り込みローカライズでスキルを残している場合は判定しない
      # （M-02「拠点の .claude/skills/<name>/ は削除しない」と両立させるため）
      if [ -d ".claude/skills/${r10_name}" ]; then
        R10_SKIP=$((R10_SKIP + 1))
        R10_INFO+=("[10] skip: ${r10_name}（実体あり）")
        continue
      fi

      n="$(r10_ere "$r10_name")"
      # 終端が自明なリテラルのみを使う（BSD の [[:<:]] は "-" を単語構成文字と見ないため
      # foo-<name> に誤爆する）。\s は BSD grep -E で使えないので [[:space:]] を使う。
      P1="${BQ}${n}${BQ}"
      P2="${n}[[:space:]]*スキル"
      P3="skills/${n}/"
      P4="${n}/SKILL[.]md"
      P5="Skill[[:space:]]*\\([[:space:]]*(skill[[:space:]]*=[[:space:]]*)?[\"']?${n}[\"']?[[:space:]]*[,)]"
      # 表セル `| <name> |`（.claude/agents の関連スキル表）。ERE で "|" を "\|" と
      # 書くのは POSIX 未定義（実装により交替演算子のままになり得る）ため、
      # リテラルであることが自明なブラケット式で書く
      P6="^[|][[:space:]]*${n}[[:space:]]*[|]"

      R10_HIT="/tmp/aidoc_r10hit_$$.txt"
      : > "$R10_HIT"
      if [ -s "$R10_F" ]; then
        tr '\n' '\0' < "$R10_F" \
          | xargs -0 env LC_ALL=C grep -nH -E -e "$P1" -e "$P2" -e "$P3" -e "$P4" -e "$P5" -e "$P6" 2>/dev/null \
          | cut -d: -f1,2 >> "$R10_HIT"
      fi
      sort -u "$R10_HIT" -o "$R10_HIT"
      r10_self=0
      while IFS= read -r loc; do
        [ -z "$loc" ] && continue
        case "$loc" in
          .claude/skills/${r10_name}/*|.agents/skills/${r10_name}/*|templates/skills/${r10_name}/*)
            r10_self=$((r10_self + 1)); continue ;;
        esac
        r10_add_f "[10] 実体の無いスキル名参照: ${loc} -> ${r10_name}（後継: ${r10_succ}）"
      done < "$R10_HIT"
      if [ "$r10_self" -gt 0 ]; then
        R10_SELF=$((R10_SELF + r10_self))
        R10_INFO+=("[10] self: ${r10_name} ${r10_self} 件（削除対象そのもの・判定に含めない）")
      fi

      : > "$R10_HIT"
      if [ -s "$R10_W" ]; then
        tr '\n' '\0' < "$R10_W" \
          | xargs -0 env LC_ALL=C grep -nH -E -e "$P1" -e "$P2" -e "$P3" -e "$P4" -e "$P5" -e "$P6" 2>/dev/null \
          | cut -d: -f1,2 >> "$R10_HIT"
      fi
      sort -u "$R10_HIT" -o "$R10_HIT"
      while IFS= read -r loc; do
        [ -z "$loc" ] && continue
        echo "[10w] 履歴・成果物内の参照: ${loc} -> ${r10_name}（後継: ${r10_succ}）" >> "$R10_WRAW"
      done < "$R10_HIT"
      rm -f "$R10_HIT"
    done < "$R10_LIST"

    if [ -s "$R10_WRAW" ]; then
      r10_wcount=$(sort -u "$R10_WRAW" | wc -l | tr -d ' ')
      if [ "${AIDOC_LIST_RETIRED:-0}" = "1" ]; then
        sort -u "$R10_WRAW" > "${R10_WRAW}.u"
        while IFS= read -r line; do
          [ -z "$line" ] && continue
          r10_add_w "$line"
        done < "${R10_WRAW}.u"
        rm -f "${R10_WRAW}.u"
      else
        r10_add_w "[10w] 履歴・成果物内の参照 ${r10_wcount} 件（AIDOC_LIST_RETIRED=1 で一覧表示）"
      fi
    fi
    rm -f "$R10_F" "$R10_W" "$R10_WRAW"
  fi

  echo ""
  if [ "${R10_NOLIST}" = "1" ]; then
    echo "--- [10] 実体の無いスキル名参照 (未検査: 廃止一覧なし) ---"
  else
    echo "--- [10] 実体の無いスキル名参照 (fail=${#R10_FAIL[@]}, warn=${#R10_WARN[@]}, skip=${R10_SKIP}, self=${R10_SELF}) ---"
  fi
  if [ ${#R10_INFO[@]} -gt 0 ]; then
    for i in "${R10_INFO[@]}"; do echo "  $i"; done
  fi
  if [ ${#R10_FAIL[@]} -gt 0 ]; then
    for v in "${R10_FAIL[@]}"; do echo "  $v"; done
  fi
  if [ ${#R10_WARN[@]} -gt 0 ]; then
    for w in "${R10_WARN[@]}"; do echo "  $w"; done
  fi
  [ "${R10_IGNORED}" -gt 0 ] && echo "  [10] .aidocignore で抑止: ${R10_IGNORED} 件"

  # [10] のみを指定した実行では、[10] の結果で終了コードを決める
  # （0 = 検査して問題なし / 1 = 検査して FAIL / 2 = 未検査）
  if [ "${ONLY}" = "10" ]; then
    if [ "${R10_NOLIST}" = "1" ]; then
      echo ""
      echo "RESULT[10]: SKIP (未検査: 廃止一覧が無い／読めない)"
      exit 2
    fi
    if [ ${#R10_FAIL[@]} -gt 0 ]; then
      echo ""
      echo "RESULT[10]: FAIL (fail=${#R10_FAIL[@]})"
      exit 1
    fi
  fi
fi

# ------------------------------------------------------------------
# [11] 名指し表の名前の実在（WARN）
# ------------------------------------------------------------------
# CLAUDE.md の「## スキル参照」節に置く「作業 → Skill ツールで名指しするスキル」表の名前が、
# 実体（.claude/skills/<name>/）を持つかを見る。表は毎ターン読まれる入口なので、
# 実体の無い名前が残ると Skill ツールの名指しがそのまま失敗する。
#
# 設計上の約束（変更しないこと）:
#   - WARN 級。[1]〜[9] の FAIL 基準は変えない。AIDOC_STRICT=1 のときだけ終了コードに効く。
#   - 対象は CLAUDE.md と templates/CLAUDE.md（在るものだけ）。範囲は見出し「## スキル参照」から
#     次の「## 」見出しまでで、コードフェンスの中は見ない。
#   - 名前として拾うのは表の行（"|" 始まり）にあるバッククォート囲みの kebab-case だけ
#     （パス・ファイル名・大文字を含む語は拾わない）。
#   - 表が無い（節が無い・節に表が無い）リポジトリでも SKIP にせず、検査した結果 0 件として
#     集計行を出す（拠点の CLAUDE.md には表が無いのが今の正しい状態）。
if run_check 11; then
  R11_SRC="/tmp/aidoc_r11_$$.txt"
  : > "$R11_SRC"
  for f in CLAUDE.md templates/CLAUDE.md; do
    [ -f "$f" ] || continue
    LC_ALL=C awk -v F="$f" '
      /^[[:space:]]*```/ { fence = !fence; next }
      fence { next }
      /^## / { insec = ($0 ~ /^## スキル参照/); next }
      insec && /^[|]/ {
        rest = $0
        while (match(rest, /`[a-z0-9][a-z0-9-]*`/)) {
          printf "%s:%d\t%s\n", F, NR, substr(rest, RSTART + 1, RLENGTH - 2)
          rest = substr(rest, RSTART + RLENGTH)
        }
      }
    ' "$f" >> "$R11_SRC"
  done
  r11_files=$(cut -f1 "$R11_SRC" | cut -d: -f1 | sort -u | grep -c . | tr -d ' ')
  r11_names=$(grep -c . "$R11_SRC" | tr -d ' ')
  r11_warn=0
  r11_ign=0
  while IFS="$(printf '\t')" read -r r11_loc r11_name; do
    [ -n "$r11_name" ] || continue
    [ -d ".claude/skills/${r11_name}" ] && continue
    r11_msg="[11] 名指し表のスキルが実在しない: ${r11_loc} -> ${r11_name}（.claude/skills/${r11_name}/ が無い）"
    if is_ignored "$r11_msg"; then
      IGNORED=$((IGNORED + 1)); r11_ign=$((r11_ign + 1))
    else
      WARNINGS+=("$r11_msg"); r11_warn=$((r11_warn + 1))
    fi
  done < "$R11_SRC"
  rm -f "$R11_SRC"
  echo ""
  if [ "$r11_files" -eq 0 ]; then
    echo "--- [11] 名指し表の名前の実在 (files=0, names=0, warn=0, ignored=${r11_ign}。名指し表なし) ---"
  else
    echo "--- [11] 名指し表の名前の実在 (files=${r11_files}, names=${r11_names}, warn=${r11_warn}, ignored=${r11_ign}) ---"
  fi
fi

# ------------------------------------------------------------------
# 結果出力
# ------------------------------------------------------------------
echo ""
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "--- WARN (${#WARNINGS[@]}) ---"
  for w in "${WARNINGS[@]}"; do echo "  $w"; done
  echo ""
fi

if [ ${#VIOLATIONS[@]} -gt 0 ]; then
  echo "--- FAIL (${#VIOLATIONS[@]}) ---"
  for v in "${VIOLATIONS[@]}"; do echo "  $v"; done
  echo ""
  r10_result_line
  echo "RESULT: FAIL (violations=${#VIOLATIONS[@]}, warnings=${#WARNINGS[@]}, ignored=${IGNORED})"
  exit 1
fi

if [ "$STRICT" = "1" ] && [ ${#WARNINGS[@]} -gt 0 ]; then
  r10_result_line
  echo "RESULT: FAIL (STRICT モード / warnings=${#WARNINGS[@]})"
  exit 1
fi

r10_result_line
echo "RESULT: PASS (violations=0, warnings=${#WARNINGS[@]}, ignored=${IGNORED})"
exit 0
