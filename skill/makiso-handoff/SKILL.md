---
name: makiso-handoff
description: Auto-summarize current session and export as agent handoff
argument-hint: e.g. "claude", "codex", "opencode"
---

# Makiso Handoff — Automated Session Export

This skill auto-summarizes the current agent session and pushes a handoff event to the makiso event bus. The resume prompt is copied to clipboard so the user can paste it into the target agent.

**The agent does ALL the work.** Do not ask the user for summary, files, next steps, or any handoff content. The only question allowed is which target agent (when not provided as an argument).

## Step 1: Determine Target Agent

Parse the skill argument for the target agent name. Valid targets: `claude`, `codex`, `opencode`.

- If argument is provided (e.g. `/makiso-handoff claude`), use it directly.
- If argument is missing, ask using `AskUserQuestion`:

```
Which agent should receive this handoff?
Options: Claude, Codex, OpenCode
```

Set `FROM_AGENT` to the current agent identity (use `@claude` if running in Claude Code, `@codex` for Codex, `@opencode` for OpenCode — infer from environment).

## Step 2: Gather Git Context

Run these commands to collect project state:

```bash
echo "CWD: $(pwd)"
git branch --show-current
git diff --name-only
git diff --cached --name-only
git log --oneline -10
```

Capture:
- `CWD` — current working directory
- `BRANCH` — current git branch
- `CHANGED_FILES` — union of unstaged + staged changed files
- `RECENT_COMMITS` — last 10 commit subjects for context

## Step 3: Self-Summarize the Session

Review the full conversation history and produce the following fields. **Do NOT ask the user for any of these — generate them yourself by analyzing what happened in this session.**

### Required Fields

- **summary** (string, 1-3 sentences): What was accomplished in this session. Be specific — mention files changed, features added, bugs fixed.
- **files** (string array): All files that were read, created, or modified during this session. Merge with `CHANGED_FILES` from git. Deduplicate.
- **next_steps** (string array, 2-5 items): Concrete, actionable items for the next agent. Each item should be a single imperative sentence. Prioritize by importance.

### Optional Fields (include when relevant)

- **goal** (string): The overarching objective that spans beyond this session.
- **constraints** (string array): Warnings, restrictions, or "do not" rules the next agent should know. Examples: "Do not modify the database schema", "Tests are currently broken on CI".
- **open_questions** (string array): Unresolved decisions or ambiguities. Examples: "Should we use Redis or in-memory cache?", "Waiting on API key from team".

## Step 4: Execute Handoff Push

### Detect CLI availability

```bash
command -v oc-events &>/dev/null && echo "CLI_AVAILABLE" || echo "CLI_MISSING"
```

### Path A: CLI available (preferred)

```bash
oc-events handoff push \
  --to <TARGET_AGENT> \
  --from <FROM_AGENT> \
  --summary "<SUMMARY>" \
  --goal "<GOAL>" \
  --next "<NEXT_STEP_1>,<NEXT_STEP_2>,..." \
  --files "<FILE_1>,<FILE_2>,..." \
  --constraints "<CONSTRAINT_1>,<CONSTRAINT_2>,..." \
  --questions "<QUESTION_1>,<QUESTION_2>,..." \
  --cwd "$(pwd)" \
  --copy
```

Omit `--goal`, `--constraints`, `--questions` flags if those fields are empty.

The `--copy` flag handles clipboard automatically. Parse the JSON output to confirm `copied_with` is not null.

### Path B: Inline SQL fallback

If CLI is not available, construct the event directly:

```bash
DB_PATH="$HOME/.config/opencode/makiso/events.db"
EVENT_ID="$(date +%s)-$$"
NOW_MS="$(($(date +%s) * 1000))"
ISO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build metadata JSON matching HandoffPayload type
METADATA=$(cat <<'METAEOF'
{
  "type": "session_handoff",
  "handoff": {
    "version": 1,
    "topic": "session-handoff",
    "to_agent": "<TO_AGENT>",
    "from_agent": "<FROM_AGENT>",
    "summary": "<SUMMARY>",
    "goal": <GOAL_OR_NULL>,
    "cwd": "<CWD>",
    "branch": "<BRANCH>",
    "files": [<FILES_ARRAY>],
    "next_steps": [<NEXT_STEPS_ARRAY>],
    "constraints": [<CONSTRAINTS_ARRAY>],
    "open_questions": [<OPEN_QUESTIONS_ARRAY>],
    "launch_hint": "<LAUNCH_COMMAND>",
    "created_at": "<ISO_NOW>"
  }
}
METAEOF
)

EVENT_BODY="Agent handoff <FROM_AGENT> -> <TO_AGENT>
Summary: <SUMMARY>
Goal: <GOAL>
Path: <CWD>
Branch: <BRANCH>
Mentions: <FROM_AGENT> <TO_AGENT>"

sqlite3 "$DB_PATH" "INSERT INTO events (id, topic, body, metadata, status, source, created_at)
  VALUES ('$EVENT_ID', 'session-handoff', '$EVENT_BODY', '$METADATA', 'pending', 'handoff', $NOW_MS)"
```

Replace all `<PLACEHOLDER>` values with the actual generated content. Properly escape single quotes in all string values for SQL safety.

**Launch hint mapping:**
- `claude` → `claude`
- `codex` → `codex`
- `opencode` → `opencode`

## Step 5: Copy Resume Prompt to Clipboard

Build the resume prompt using this exact format (matches `buildHandoffPrompt` in `src/cli.ts:183-242`):

```
=== BEGIN AGENT HANDOFF ===
You are taking over an in-progress task.

From Agent: <FROM_AGENT>
To Agent: <TO_AGENT>
Project Path: <CWD>
Branch: <BRANCH>
Summary: <SUMMARY>
Goal: <GOAL>

Files Changed:
- <FILE_1>
- <FILE_2>

Next Steps:
1. <STEP_1>
2. <STEP_2>

Constraints:
- <CONSTRAINT_1>

Open Questions:
- <QUESTION_1>

Suggested launch command: <LAUNCH_HINT>
=== END AGENT HANDOFF ===
```

Rules for the prompt format:
- Omit `Goal:` line if goal is null
- If no files, show `- none provided`
- If no next steps, show `1. Continue from current summary`
- Omit entire `Constraints:` section if empty
- Omit entire `Open Questions:` section if empty
- Omit `Suggested launch command:` line if launch_hint is null

If using the CLI path (`--copy`), the clipboard is already handled. For the SQL fallback path, copy manually:

```bash
# macOS
echo "<RESUME_PROMPT>" | pbcopy

# Linux (Wayland)
echo "<RESUME_PROMPT>" | wl-copy

# Linux (X11)
echo "<RESUME_PROMPT>" | xclip -selection clipboard
```

Try `pbcopy` first, then `wl-copy`, then `xclip`. Use whichever succeeds.

## Step 6: Report to User

Display a confirmation message:

```
Handoff exported successfully.

From: <FROM_AGENT>
To:   <TO_AGENT>
Clipboard: copied ✓

Resume prompt:

<THE_FULL_RESUME_PROMPT>
```

If clipboard copy failed, show `Clipboard: failed (paste manually from above)` instead.

## Rules

1. **Never ask the user for summary, files, or next steps.** The entire point of this skill is self-summarization. Generate all content by reviewing conversation history.
2. **Only allowed question:** Which target agent — and only when the argument is missing.
3. **Resume prompt format must match exactly.** The format is defined in `buildHandoffPrompt` (`src/cli.ts:183-242`). Do not deviate.
4. **Metadata JSON must match `HandoffPayload` type** (`src/cli.ts:152-167`). All fields must be present, with null for missing optional values.
5. **CLI first, SQL fallback.** Always try `oc-events handoff push` before falling back to inline SQL.
6. **Always copy to clipboard.** Use `--copy` flag (CLI) or platform clipboard commands (SQL fallback).
