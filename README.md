# makiso - event queuing and delayed-execution

Local-first pub/sub event system for LLM agent coordination in OpenCode.

**Name origin:** "Make it so"

## Quick Start (No Dependencies)

```bash
mkdir -p ~/.config/opencode/skill/makiso && \
curl -sL https://raw.githubusercontent.com/keybrdist/opencode-makiso/main/skill/SKILL.md \
  -o ~/.config/opencode/skill/makiso/SKILL.md
```

Restart OpenCode and say **"check events"** to get started. The skill auto-bootstraps the SQLite database on first use using the pre-installed `sqlite3` command.

## What This Is

- SQLite + FTS5 event store optimized for @mentions and tool-call lookup
- Self-bootstrapping skill that works with just `sqlite3` (no Node.js required)
- OpenCode skill with sub-commands for pulling PRs, Jiras, and Bugs
- Optional CLI for power users who want enhanced features

## How It Works

### Manual Event Checking (Default)

Ask the AI to check for events:

- "Check for events"
- "Any pending tasks?"
- "Pull the next event"

The AI will:

1. Check for pending events in the inbox
2. Process the event according to its topic
3. Reply with the result

### Sub-Commands

| Command | Description |
|---------|-------------|
| `.check-prs` | Fetch open PRs that need review |
| `.check-jira` | Fetch Jira issues assigned to you |
| `.checkbugs` | Fetch Bugsnag errors needing investigation |
| `.checkall` | Run all three sub-commands |

### Core Operations

All operations work with or without the CLI installed:

| Operation | CLI | Inline SQL |
|-----------|-----|------------|
| Push event | `oc-events push inbox --body "..."` | `sqlite3 ~/.config/opencode/makiso/events.db "INSERT INTO events..."` |
| Pull event | `oc-events pull inbox --agent @opencode` | `sqlite3 ~/.config/opencode/makiso/events.db "UPDATE events SET status='processing'..."` |
| Reply | `oc-events reply <id> --status completed` | `sqlite3 ~/.config/opencode/makiso/events.db "UPDATE events SET status='completed'..."` |
| Search | `oc-events search "query"` | `sqlite3 ~/.config/opencode/makiso/events.db "SELECT * FROM events_fts..."` |

See the skill file for complete SQL templates.

## Configuration

All data is stored in `~/.config/opencode/makiso/`:

```
~/.config/opencode/makiso/
├── events.db          # SQLite database (auto-created)
└── prompts/           # Custom prompt overrides
```

## Optional: Full CLI

For power users who want better error messages and additional features:

```bash
git clone https://github.com/keybrdist/opencode-makiso.git
cd opencode-makiso
npm install && npm run build && npm link
```

This makes `oc-events` available globally. The skill automatically uses the CLI when available.

### CLI Commands

| Command | Description |
|---------|-------------|
| `oc-events push <topic> --body "..."` | Publish an event |
| `oc-events pull <topic> --agent <id>` | Claim the next pending event |
| `oc-events reply <id> --status <status> --body "..."` | Reply and update status |
| `oc-events watch <topic> --agent <id>` | Watch for events in real-time |
| `oc-events search <query>` | Full-text search event bodies |
| `oc-events query --mention @name` | Find events mentioning someone |
| `oc-events topics list` | List all topics |
| `oc-events cleanup` | Remove old events |

## Uninstall

```bash
rm -rf ~/.config/opencode/skill/makiso
rm -rf ~/.config/opencode/makiso  # Removes database too
```

## Repo Layout

```
opencode-makiso/
├── src/               # CLI source (TypeScript)
├── skill/             # OpenCode skill files
├── prompts/           # Default sub-command prompt templates
└── dist/              # Build output
```
