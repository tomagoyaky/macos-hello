#!/usr/bin/env python3
"""GitFlow guard — PreToolUse hook for the Bash tool.

Blocks `git commit` when the target repository is not on a GitFlow branch, or
when the commit message is not a conventional commit. Everything else is left
untouched.

Design rules:
  * Fail-open.  Any internal error (bad JSON, missing git, unparsable command)
    results in the command being allowed, never blocked.  A broken guard must
    not break normal work.
  * Cheap.  Pure local, no network, a handful of short `git` calls.
  * Quiet.  When the command is fine, exit 0 with no output at all.

Hook contract (verified against the Claude Code hooks reference and against a
working deny implementation in this environment):
  stdin  : {"tool_name": "Bash", "tool_input": {"command": "..."}, "cwd": "..."}
  deny   : stdout {"continue": true,
                   "hookSpecificOutput": {"hookEventName": "PreToolUse",
                                          "permissionDecision": "deny",
                                          "permissionDecisionReason": "..."}}
  allow  : exit 0, no output (optionally additionalContext / systemMessage)
"""

import json
import os
import re
import shlex
import subprocess
import sys

# --------------------------------------------------------------------------
# Defaults (overridable per project via .claude/gitflow-hooks/config.json or
# via the GITFLOW_HOOKS_CONFIG environment variable)
# --------------------------------------------------------------------------
DEFAULT_CONFIG = {
    # Branch names allowed to receive commits (fnmatch-style globs).
    "branch_whitelist": [
        "develop", "main",
        "release/*", "hotfix/*", "feature/*", "fix/*", "chore/*",
    ],
    # Conventional commits: type(scope): subject
    "message_regex": r"^(feat|fix|docs|chore|refactor|test|perf|ci|style)(\([^)]+\))?: .+",
    # Prefixes git itself generates, or that autosquash needs.
    "message_exempt_prefixes": ["Merge ", "Revert ", "fixup! ", "squash! "],
    # Commit on a detached HEAD is almost always a mistake -> block.
    "deny_detached_head": True,
    # During merge/rebase/cherry-pick the repo is mid-operation; a commit then
    # is part of that operation, so do not enforce the branch whitelist.
    "allow_during_operation": True,
    # Non-blocking advice when committing directly on develop.
    "hint_on_develop": True,
    # Waiver.  Must only ever be used by the human operator (see SKILL.md).
    "skip_env_var": "GITFLOW_HOOKS_SKIP",
    # Every waiver use is appended here and announced to the user.
    # Home-relative on purpose: the project config may be shared, but the log
    # stays on each person's own machine.
    "audit_log": "~/.claude/gitflow-hooks-skip.log",
}

BRANCH_HINT = ("feature/<描述>、fix/<描述>、chore/<描述>")
MESSAGE_EXAMPLE = "feat(api): 新增车辆列表分页参数"

# Shell control operators that delimit independent commands.
SEPARATOR_RE = re.compile(r"(&&|\|\||;|\||&|\n)")
ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SHELL_PREFIXES = {"sudo", "command", "nohup", "time", "env", "exec"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
# git global options that consume the following token as their value.
GIT_VALUE_FLAGS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace",
                   "--exec-path", "--config-env"}
# `git commit` short flags that consume a value.
COMMIT_VALUE_SHORT = {"m", "F", "c", "C", "t"}


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)


def deny(reason):
    emit({
        "continue": True,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    })


def allow_with_context(text):
    emit({
        "continue": True,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": text,
        },
    })


def load_config(project_dir):
    cfg = dict(DEFAULT_CONFIG)
    path = os.environ.get("GITFLOW_HOOKS_CONFIG") or os.path.join(
        project_dir, ".claude", "gitflow-hooks", "config.json")
    try:
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                cfg.update(json.load(fh))
    except Exception:
        pass  # unreadable config -> built-in defaults
    return cfg


def run_git(repo, args, timeout=5):
    """Run git with optional locks disabled; return stdout or None on failure."""
    env = dict(os.environ)
    env["GIT_OPTIONAL_LOCKS"] = "0"   # never take the index lock
    env["LC_ALL"] = "C"
    try:
        proc = subprocess.run(
            ["git", "-C", repo] + args,
            capture_output=True, text=True, timeout=timeout, env=env,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


# --------------------------------------------------------------------------
# Shell command analysis
# --------------------------------------------------------------------------
def split_segments(command):
    """Split a shell command line on unquoted control operators."""
    segments, buf, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            elif ch == "\\" and quote == '"' and i + 1 < len(command):
                buf.append(command[i + 1])
                i += 1
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
        elif ch == "\\" and i + 1 < len(command):
            buf.append(ch)
            buf.append(command[i + 1])
            i += 1
        else:
            m = SEPARATOR_RE.match(command, i)
            if m:
                segments.append("".join(buf))
                buf = []
                i = m.end()
                continue
            buf.append(ch)
        i += 1
    segments.append("".join(buf))
    return [s.strip() for s in segments if s.strip()]


def tokenize(segment):
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return None


def strip_prefixes(tokens):
    """Drop leading `VAR=x`, sudo, command, env ... from a token list."""
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        if ENV_ASSIGN_RE.match(tok):
            idx += 1
            continue
        if tok.rsplit("/", 1)[-1] in SHELL_PREFIXES:
            idx += 1
            continue
        break
    return tokens[idx:]


def parse_git_command(tokens):
    """Return (repo_override, subcommand, rest) if tokens start with `git`."""
    if not tokens:
        return None
    if tokens[0].rsplit("/", 1)[-1] != "git":
        return None
    i, repo = 1, None
    while i < len(tokens):
        tok = tokens[i]
        if tok == "--":
            break
        if tok.startswith("--"):
            name, _, inline = tok.partition("=")
            if name in GIT_VALUE_FLAGS:
                value = inline if inline else (tokens[i + 1] if i + 1 < len(tokens) else None)
                if name == "-C":
                    repo = value
                i += 2 if not inline else 1
                continue
            i += 1
            continue
        if tok.startswith("-") and len(tok) > 1:
            flag = tok[:2]
            if flag in GIT_VALUE_FLAGS:
                value = tok[2:] or (tokens[i + 1] if i + 1 < len(tokens) else None)
                if flag == "-C":
                    repo = value
                i += 2 if len(tok) == 2 else 1
                continue
            i += 1
            continue
        return repo, tok, tokens[i + 1:]
    return None


def parse_commit_args(args):
    """Extract message / amend / no-verify / fixup from `git commit` arguments."""
    info = {"messages": [], "amend": False, "no_verify": False,
            "auto_message": False, "file": None, "stdin_file": False}
    i = 0
    while i < len(args):
        tok = args[i]
        if tok == "--":
            break
        if tok.startswith("--"):
            name, _, inline = tok.partition("=")
            if name in ("--message", "--file"):
                if inline:
                    value = inline
                else:
                    value = args[i + 1] if i + 1 < len(args) else ""
                    i += 1
                if name == "--message":
                    info["messages"].append(value)
                else:
                    info["file"] = value
            elif name == "--amend":
                info["amend"] = True
            elif name == "--no-edit":
                info["amend"] = True
            elif name in ("--no-verify", "--verify"):
                info["no_verify"] = name == "--no-verify"
            elif name in ("--fixup", "--squash"):
                info["auto_message"] = True
                if not inline and i + 1 < len(args) and not args[i + 1].startswith("-"):
                    i += 1
            i += 1
            continue
        if tok.startswith("-") and len(tok) > 1:
            chars, j = tok[1:], 0
            while j < len(chars):
                ch = chars[j]
                if ch in COMMIT_VALUE_SHORT:
                    rest = chars[j + 1:]
                    if rest:
                        value = rest
                    else:
                        value = args[i + 1] if i + 1 < len(args) else ""
                        i += 1
                    if ch == "m":
                        info["messages"].append(value)
                    elif ch == "F":
                        info["file"] = value
                    j = len(chars)
                    continue
                if ch == "n":
                    info["no_verify"] = True
                j += 1
            i += 1
            continue
        i += 1
    if info["file"] == "-":
        info["stdin_file"] = True
    return info


def extract_message(info, repo):
    """Best-effort commit-message resolution. None = cannot tell -> skip check."""
    raw = None
    if info["messages"]:
        raw = "\n\n".join(info["messages"])
    elif info["file"] and not info["stdin_file"]:
        try:
            path = info["file"] if os.path.isabs(info["file"]) else os.path.join(repo, info["file"])
            with open(path, encoding="utf-8", errors="replace") as fh:
                raw = fh.read()
        except Exception:
            return None
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    # Heredoc form:  -m "$(cat <<'EOF' ... EOF )"  -> take the heredoc body.
    heredoc = re.search(r"<<[-]?['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\s*\n(.*?)\n\1",
                        raw, re.DOTALL)
    if heredoc:
        raw = heredoc.group(2).strip()
    # Anything still containing a substitution cannot be judged locally.
    if "$(" in raw or "`" in raw:
        return None
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return None
    return lines[0].strip()


# --------------------------------------------------------------------------
# Repository state
# --------------------------------------------------------------------------
def in_progress_operation(repo):
    git_dir = run_git(repo, ["rev-parse", "--git-dir"])
    if not git_dir:
        return False
    if not os.path.isabs(git_dir):
        git_dir = os.path.join(repo, git_dir)
    for marker in ("rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD",
                   "REVERT_HEAD", "MERGE_HEAD"):
        if os.path.exists(os.path.join(git_dir, marker)):
            return True
    return False


def head_is_published(repo):
    """True if HEAD sits on any remote-tracking branch (i.e. was pushed)."""
    out = run_git(repo, ["branch", "-r", "--contains", "HEAD"])
    if out is None:
        # No remote configured, or command failed: cannot prove it is published.
        return False
    return bool(out.strip())


def branch_matches(branch, patterns):
    import fnmatch
    return any(fnmatch.fnmatchcase(branch, pat) for pat in patterns)


# --------------------------------------------------------------------------
# Core evaluation — returns a list of violation strings
# --------------------------------------------------------------------------
def evaluate(command, cwd, cfg, depth=0):
    violations, hints = [], []
    for segment in split_segments(command):
        tokens = tokenize(segment)
        if not tokens:
            continue
        tokens = strip_prefixes(tokens)
        if not tokens:
            continue
        # bash -c "git commit ..." -> inspect the inner script.
        head = tokens[0].rsplit("/", 1)[-1]
        if head in SHELLS and depth < 2:
            for k, tok in enumerate(tokens):
                if tok == "-c" and k + 1 < len(tokens):
                    sub_v, sub_h = evaluate(tokens[k + 1], cwd, cfg, depth + 1)
                    violations += sub_v
                    hints += sub_h
                    break
            continue
        parsed = parse_git_command(tokens)
        if not parsed:
            continue
        repo_override, subcommand, rest = parsed
        if subcommand != "commit":
            continue
        violations += check_commit(repo_override, rest, cwd, cfg, hints)
    return violations, hints


def check_commit(repo_override, args, cwd, cfg, hints):
    problems = []
    info = parse_commit_args(args)
    repo = repo_override or cwd
    if not os.path.isdir(repo):
        return []

    branch = run_git(repo, ["symbolic-ref", "--short", "-q", "HEAD"])
    if branch is None:
        branch = run_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
    if branch is None:
        return []  # not a git repository -> nothing to police
    detached = branch in ("HEAD", "")

    # --- dangerous flags -------------------------------------------------
    if info["no_verify"]:
        problems.append(
            "`git commit --no-verify` 会跳过项目自身的 git 钩子，属于需要人工确认的破坏性操作。"
            "请先向用户说明为什么要跳过，得到同意后再执行。")
    if info["amend"] and head_is_published(repo):
        problems.append(
            "`git commit --amend`：当前 HEAD 已经存在于远程分支（已被推送）。"
            "改写已推送的历史会影响其他人，必须先与用户确认。")

    # --- branch whitelist -----------------------------------------------
    mid_operation = cfg["allow_during_operation"] and in_progress_operation(repo)
    if detached and not mid_operation and cfg["deny_detached_head"]:
        problems.append(
            f"当前处于 detached HEAD（不在任何分支上），提交会丢失归属。"
            f"请先切到合适的分支，例如 `git switch -c feature/<描述>`。")
    elif not detached and not mid_operation and not branch_matches(branch, cfg["branch_whitelist"]):
        problems.append(
            f"分支 `{branch}` 不在 GitFlow 白名单内。"
            f"本仓库约定：日常开发在 `develop`，单个关注点从 `develop` 拉出 "
            f"`{BRANCH_HINT}`，发布走 `release/*`，紧急修复走 `hotfix/*`。"
            f"请重命名或新建分支后再提交（例如 `git switch -c feature/<描述>`）。")

    # --- commit message ---------------------------------------------------
    message = extract_message(info, repo)
    if message and not info["auto_message"]:
        exempt = any(message.startswith(p) for p in cfg["message_exempt_prefixes"])
        if not exempt and not re.match(cfg["message_regex"], message):
            problems.append(
                f"提交信息 `{message}` 不符合 conventional commits 格式。"
                f"要求 `^(feat|fix|docs|chore|refactor|test|perf|ci|style)(\\(scope\\))?: 描述`，"
                f"例如：`{MESSAGE_EXAMPLE}`。"
                f"（git 生成的 `Merge ...` / `Revert ...`、autosquash 的 `fixup! ...` 不受此限制）")

    # --- non-blocking advice ---------------------------------------------
    if not problems and not detached and branch == "develop" and cfg["hint_on_develop"]:
        hints.append(
            f"[gitflow-hooks 提示] 你正在 `develop` 上直接提交（已放行）。"
            f"若这是一次较大的改动，建议改从 `develop` 拉出 {BRANCH_HINT} 分支提交。")
    return problems


# --------------------------------------------------------------------------
def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)  # unparsable input -> fail open
    if payload.get("tool_name") not in (None, "", "Bash"):
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    cwd = payload.get("cwd") or os.getcwd()
    if "commit" not in command:          # cheap pre-filter
        sys.exit(0)

    cfg = load_config(cwd)

    # --- waiver (human-only; announced + audited) -------------------------
    skip_var = cfg.get("skip_env_var") or "GITFLOW_HOOKS_SKIP"
    if os.environ.get(skip_var):
        audit(cfg, command, cwd, skip_var)
        emit({"systemMessage": (
            f"⚠️ gitflow-hooks 校验已被跳过（{skip_var}=1）：`{command}`。"
            f"该跳过只应由用户本人使用，已记入 {os.path.expanduser(cfg['audit_log'])}。")})

    violations, hints = evaluate(command, cwd, cfg)
    if violations:
        body = "\n".join(f"- {v}" for v in violations)
        deny(f"GitFlow 校验未通过，已阻止本次提交：\n{body}\n\n"
             f"调整分支名或提交信息后重试；若确实需要跳过，请让用户本人设置环境变量 {skip_var}。")
    if hints:
        allow_with_context("\n".join(hints))
    sys.exit(0)


def audit(cfg, command, cwd, skip_var):
    try:
        path = os.path.expanduser(cfg.get("audit_log") or DEFAULT_CONFIG["audit_log"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{skip_var}=1 cwd={cwd} cmd={command}\n")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # fail-open: never block on our own bug
        sys.stderr.write(f"[gitflow-hooks] internal error, allowing command: {exc!r}\n")
        sys.exit(0)