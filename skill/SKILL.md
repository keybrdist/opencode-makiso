---
name: event-crusher
description: Publish, pull, search, and reply to OpenCode events
argument-hint: e.g. "check events", ".pullprs", ".pulljira", ".pullbugs"
---

# OpenCode Event Crusher

A local-first pub/sub system for coordinating LLM agents with events stored in SQLite.

## Event Checking

When the user asks you to check for events (e.g., "check events", "any pending tasks?"):

### Step 1: Check inbox first
```bash
oc-events pull inbox --agent @opencode
```

### Step 2: If inbox is empty, check all topics for pending events
```bash
oc-events topics list
# Then check each active topic, or query all pending:
sqlite3 ~/.config/opencode/event-crusher/events.db "SELECT id, topic, substr(body, 1, 100) FROM events WHERE status = 'pending' LIMIT 10"
```

### Step 3: If a specific event exists but wasn't found
Events may be on different topics (e.g., `review-and-deploy`, `bugfix`, `feature`). If the user mentions a specific event ID:
```bash
oc-events status <event-id> --set pending  # Reset if stuck in 'processing'
oc-events pull <topic> --agent @opencode   # Pull from the correct topic
```

### Processing Events
If an event is returned:
1. Read the event body and system prompt carefully
2. Execute the requested action
3. Reply with: `oc-events reply <event-id> --status completed --body "your response"`

If no events are found across all topics, inform the user there are no pending events.

## Sub-Commands (Event Sources)

The following sub-commands fetch data from external sources and create events automatically.

### .pullprs - Pull PRs for Review

When the user says `.pullprs`, `pull prs`, or `check PRs`:

1. Read the prompt template from:
   - User override: `~/.config/opencode/event-crusher/prompts/pull-prs.md`
   - Default: `~/projects/opencode-event-crusher/prompts/pull-prs.md`

2. Follow the instructions in the prompt to:
   - Load the bitbucket skill
   - Fetch open PRs needing review
   - Create events for each PR
   - Report summary

### .pulljira - Pull Jira/Linear Issues

When the user says `.pulljira`, `pull jiras`, `pull issues`, or `check issues`:

1. Read the prompt template from:
   - User override: `~/.config/opencode/event-crusher/prompts/pull-jiras.md`
   - Default: `~/projects/opencode-event-crusher/prompts/pull-jiras.md`

2. Follow the instructions in the prompt to:
   - Load the linear skill (or atlassian skill for Jira)
   - Fetch assigned issues needing attention
   - Create events for each issue
   - Report summary

### .pullbugs - Pull Bugsnag Errors

When the user says `.pullbugs`, `pull bugs`, or `check errors`:

1. Read the prompt template from:
   - User override: `~/.config/opencode/event-crusher/prompts/pull-bugs.md`
   - Default: `~/projects/opencode-event-crusher/prompts/pull-bugs.md`

2. Follow the instructions in the prompt to:
   - Load the bugsnag skill
   - Fetch recent errors needing investigation
   - Create events for high-impact issues
   - Report summary

### .pullall - Pull All Sources

When the user says `.pullall` or `pull all`:

Execute all three sub-commands in sequence:
1. `.pullprs`
2. `.pulljira`
3. `.pullbugs`

Report combined summary at the end.

## Core Commands

### Publish
- `oc-events push <topic> --body "..."`
- Optional: `--meta '{"key":"value"}' --source <source> --correlation-id <id>`

### Consume
- `oc-events pull <topic> --agent "@opencode"`

### Reply
- `oc-events reply <id> --status completed --body "..."`
- Use `--status failed` for failures

### Watch (separate terminal)
- `oc-events watch <topic> --agent <id> --interval <ms>`

### Query
- `oc-events query --mention @name`
- `oc-events query --tool bash`

### Search
- `oc-events search "text query"`

### Topics
- `oc-events topics list`
- `oc-events topics create <topic> --prompt "..." --description "..."`
- `oc-events topics set-prompt <topic> --prompt-file ./prompt.md`

### Cleanup
- `oc-events cleanup --completed-days 30 --pending-days 7`

## Configuration

- Data directory: `~/.config/opencode/event-crusher/`
- Prompts directory: `~/.config/opencode/event-crusher/prompts/`
- Database: `~/.config/opencode/event-crusher/events.db`
- Debug log: `~/.config/opencode/event-crusher/plugin.log`

Environment variables:
- `OC_AGENT_ID` - Agent identity (default: `@opencode`)
- `OC_EVENTS_TOPIC` - Plugin polling topic (default: `inbox`)
- `OC_EVENTS_POLL_INTERVAL_MS` - Polling interval (default: `60000`)
- `OC_EVENTS_DEBUG` - Enable debug logging (set to `1`)
