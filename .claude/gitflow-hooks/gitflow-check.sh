#!/usr/bin/env bash
# Manual GitFlow audit for the current repository. Read-only: it only reads
# branch / status / log and prints a verdict, so it is safe to run any time.
#
#   gitflow-check.sh [-C <repo-dir>] [-m "<候选提交信息>"]
#
# With -m the candidate message is checked against the same conventional
# commits rule the PreToolUse hook enforces, which is handy before committing.
set -uo pipefail

REPO="."
CANDIDATE=""
BRANCH_WHITELIST="develop main release/* hotfix/* feature/* fix/* chore/*"
MESSAGE_REGEX='^(feat|fix|docs|chore|refactor|test|perf|ci|style)(\([^)]+\))?: .+'

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) REPO="$2"; shift 2 ;;
    -m) CANDIDATE="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

git -C "$REPO" rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "不是 git 仓库：$REPO" >&2; exit 1
}
ROOT="$(git -C "$REPO" rev-parse --show-toplevel)"
BRANCH="$(git -C "$REPO" symbolic-ref --short -q HEAD || echo '(detached HEAD)')"

echo "仓库     : $ROOT"
echo "当前分支 : $BRANCH"

# --- branch verdict -------------------------------------------------------
branch_ok=no
if [[ "$BRANCH" == "(detached HEAD)" ]]; then
  echo "分支判定 : ✗ detached HEAD，不在任何分支上，提交会丢失归属"
else
  for pat in $BRANCH_WHITELIST; do
    # shellcheck disable=SC2053  # glob on purpose
    if [[ "$BRANCH" == $pat ]]; then branch_ok=yes; break; fi
  done
  if [[ "$branch_ok" == yes ]]; then
    echo "分支判定 : ✓ 在白名单内（${BRANCH_WHITELIST}）"
  else
    echo "分支判定 : ✗ 不在白名单内（${BRANCH_WHITELIST}）"
    echo "           建议：git switch -c feature/<描述> | fix/<描述> | chore/<描述>"
  fi
fi

# --- working tree ---------------------------------------------------------
echo
echo "未提交改动："
if [[ -z "$(git -C "$REPO" status --porcelain)" ]]; then
  echo "  （工作区干净）"
else
  git -C "$REPO" status --short | sed 's/^/  /'
fi

# --- message verdict ------------------------------------------------------
echo
LAST_MSG="$(git -C "$REPO" log -1 --pretty=%s 2>/dev/null || echo '')"
check_msg() {
  local msg="$1"
  if [[ -z "$msg" ]]; then echo "无"; return; fi
  case "$msg" in
    "Merge "*|"Revert "*|"fixup! "*|"squash! "*) echo "✓（git 生成 / autosquash，豁免）"; return ;;
  esac
  if [[ "$msg" =~ $MESSAGE_REGEX ]]; then
    echo "✓ 符合 conventional commits"
  else
    echo "✗ 不符合 conventional commits，示例：feat(api): 新增车辆列表分页参数"
  fi
}
echo "最近一次提交 : $LAST_MSG"
echo "格式判定     : $(check_msg "$LAST_MSG")"

if [[ -n "$CANDIDATE" ]]; then
  echo
  echo "候选提交信息 : $CANDIDATE"
  echo "格式判定     : $(check_msg "$CANDIDATE")"
fi