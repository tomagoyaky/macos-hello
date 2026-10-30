#!/usr/bin/env python3
"""GitFlow reminder — Stop hook.

When a task ends with uncommitted changes in the repository, show a short
reminder to the user. It NEVER blocks: the hook always exits 0 and never emits
`decision: "block"`, so it cannot trap the agent in a stop/continue loop.

This is deliberate. The workspace convention is that development agents do not
commit while work is in progress -- the main context groups and commits changes
after acceptance. A blocking hook here would fight that convention.
"""

import json
import os
import subprocess
import sys

MAX_LISTED_FILES = 8


def run_git(repo, args, timeout=5):
    env = dict(os.environ)
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["LC_ALL"] = "C"
    try:
        proc = subprocess.run(["git", "-C", repo] + args,
                              capture_output=True, text=True,
                              timeout=timeout, env=env)
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)
    cwd = payload.get("cwd") or os.getcwd()

    porcelain = run_git(cwd, ["status", "--porcelain"])
    if not porcelain or not porcelain.strip():
        sys.exit(0)

    lines = [ln for ln in porcelain.splitlines() if ln.strip()]
    branch = run_git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"])
    branch = branch.strip() if branch and branch.strip() else "(detached HEAD)"
    root = run_git(cwd, ["rev-parse", "--show-toplevel"])
    root = root.strip() if root and root.strip() else cwd

    shown = "\n".join("  " + ln for ln in lines[:MAX_LISTED_FILES])
    more = "" if len(lines) <= MAX_LISTED_FILES else f"\n  … 另有 {len(lines) - MAX_LISTED_FILES} 项"
    message = (
        f"📌 gitflow-hooks 提醒（不阻断）：`{root}` 分支 `{branch}` 还有 "
        f"{len(lines)} 处未提交的改动：\n{shown}{more}\n"
        f"按本仓库约定，开发过程中由各 agent 各自推进、不各自提交，"
        f"验收后由主上下文统一分组提交（`git commit -- <paths>`）。"
        f"请确认是否需要提交，无需提交可忽略本提醒。"
    )
    sys.stdout.write(json.dumps({"systemMessage": message, "suppressOutput": False},
                                ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        sys.stderr.write(f"[gitflow-hooks] stop-check internal error: {exc!r}\n")
        sys.exit(0)