# makiso - local-first agent workflow coordination

Local-first coordination layer for OpenCode agents with scoped routing, workflow intake, and durable execution history.

**Name origin:** "Make it so"

## Why Makiso

- Route work safely across `org/workspace/project/repo` boundaries without cross-repo bleed
- Convert PR/Jira/Bugs queues into actionable events with `.check-prs`, `.check-jira`, `.checkbugs`, and `.checkall`
- Keep coordination auditable and searchable in SQLite + FTS5
- Start with zero runtime dependencies beyond pre-installed `sqlite3`
- Add the optional `oc-events` CLI for richer automation and control

## Quick Start (No Dependencies)

```bash
mkdir -p ~/.config/opencode/skill/makiso && \
curl -sL https://raw.githubusercontent.com/keybrdist/opencode-makiso/main/skill/SKILL.md \
  -o ~/.config/opencode/skill/makiso/SKILL.md
```

Restart OpenCode and say **"check events"** to get started. The skill auto-bootstraps the SQLite database on first use using the pre-installed `sqlite3` command.

## Core Capabilities

- SQLite + FTS5 event store optimized for @mentions and tool-call lookup
- Self-bootstrapping skill that works with just `sqlite3` (no Node.js required)
- OpenCode skill with sub-commands for pulling PRs, Jiras, and Bugs
- Optional CLI for power users who want enhanced features
- First-class scope boundaries for `org/workspace/project/repo`

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
| Push event | `oc-events push inbox --body "..." --org acme --repo lgapi` | `sqlite3 ~/.config/opencode/makiso/events.db "INSERT INTO events..."` |
| Pull event | `oc-events pull inbox --agent @opencode --org acme --repo lgapi --scope repo` | `sqlite3 ~/.config/opencode/makiso/events.db "UPDATE events SET status='processing'..."` |
| Reply | `oc-events reply <id> --status completed` | `sqlite3 ~/.config/opencode/makiso/events.db "UPDATE events SET status='completed'..."` |
| Search | `oc-events search "query" --org acme --scope org` | `sqlite3 ~/.config/opencode/makiso/events.db "SELECT * FROM events_fts..."` |

See the skill file for complete SQL templates.

## Configuration

All data is stored in `~/.config/opencode/makiso/`:

```
~/.config/opencode/makiso/
├── events.db          # SQLite database (auto-created)
└── prompts/           # Custom prompt overrides
```

Scope defaults can be configured globally:

```bash
export OC_EVENTS_DEFAULT_ORG=acme
export OC_EVENTS_DEFAULT_WORKSPACE=platform
export OC_EVENTS_DEFAULT_PROJECT=distribution
export OC_EVENTS_DEFAULT_REPO=lgapi
```

You can also persist context in the database:

```bash
oc-events context set --org acme --workspace platform --project distribution --repo lgapi
oc-events context show
oc-events context clear
```

Default read/write behavior uses the resolved context and defaults to `repo` scope.  
Cross-repo traversal is explicit with `--scope project|workspace|org`.  
Cross-org access is explicit with `--org <id>`.

## Agent Handoff

Makiso now supports portable handoff prompts for switching between coding agents.

Create a handoff for another agent:

```bash
oc-events handoff push \
  --to claude \
  --from codex \
  --summary "Implemented scoped events and migrations" \
  --goal "Finish docs and open PR" \
  --next "Run smoke tests,Prepare commit,Open PR" \
  --files "src/cli.ts,src/db/schema.ts" \
  --copy
```

Pull a handoff for an agent:

```bash
oc-events handoff pull --for claude --agent @claude --scope repo --copy
```

Both commands return JSON with an `event` and a ready-to-paste `prompt`.

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
| `oc-events push <topic> --body "..." [--org ... --workspace ... --project ... --repo ...]` | Publish an event |
| `oc-events pull <topic> --agent <id> [--scope repo\|project\|workspace\|org] [--include-unscoped]` | Claim the next pending event |
| `oc-events reply <id> --status <status> --body "..."` | Reply and update status |
| `oc-events status <id> --set <status>` | Update status without creating a reply |
| `oc-events watch <topic> --agent <id> [--scope ...] [--include-unscoped]` | Watch for events in real-time |
| `oc-events search <query> [--scope ...] [--include-unscoped]` | Full-text search event bodies |
| `oc-events query --mention @name [--scope ...] [--include-unscoped]` | Find events mentioning someone |
| `oc-events context show\|set\|clear` | Manage saved scope context |
| `oc-events handoff push ...` | Create a session handoff event with a copy-paste prompt |
| `oc-events handoff pull ...` | Claim the next handoff for an agent and emit its prompt |
| `oc-events topics list` | List all topics |
| `oc-events topics create <topic> --prompt "..."` | Create a topic prompt inline |
| `oc-events topics set-prompt <topic> --prompt-file <path>` | Set a topic prompt from file |
| `oc-events cleanup [--scope ...] [--include-unscoped]` | Remove old events |

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
