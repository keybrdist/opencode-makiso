# makiso - event queuing and delayed-execution

Local-first pub/sub event system for LLM agent coordination in OpenCode.

## What this is

- SQLite + FTS5 event store optimized for @mentions and tool-call lookup
- CLI-first workflow for push/pull/query/reply
- OpenCode skill with sub-commands for pulling PRs, Jiras, and Bugs
- OpenCode plugin that polls for incoming events on session idle
- Optional webhook server for external event ingestion

## Installation

### 1. Build the project

```bash
cd ~/projects/opencode-makiso
npm install
npm run build
npm link  # Makes oc-events available globally
```

### 2. Install the skill (for AI event execution)

```bash
ln -s ~/projects/opencode-makiso/skill ~/.config/opencode/skill/makiso
```

The skill allows the AI to check for and execute events. **By default, this is manual** - you need to ask the AI to check for events (e.g., "check for events", "any pending tasks?"). The AI will then pull and execute any pending events.

### 3. (Optional) Add the OpenCode plugin

Add the plugin to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "~/projects/opencode-makiso"
  ]
}
```

### 4. Restart OpenCode

After installing the skill and/or plugin, restart OpenCode to load the changes.

## Sub-Commands (Event Sources)

The events skill supports special sub-commands to fetch tasks from external sources and create events automatically.

### .pullprs - Pull PRs for Review

```
.pullprs
```

Fetches open pull requests from Bitbucket that need your review and creates events for each one.

### .pulljira - Pull Jira/Linear Issues

```
.pulljira
```

Fetches issues from Linear (or Jira) that are assigned to you and need attention.

### .pullbugs - Pull Bugsnag Errors

```
.pullbugs
```

Fetches recent errors from Bugsnag that need investigation.

### .pullall - Pull All Sources

```
.pullall
```

Runs all three sub-commands in sequence.

### Customizing Sub-Commands

Default prompt templates are in `~/projects/opencode-makiso/prompts/`:

- `pull-prs.md`
- `pull-jiras.md`
- `pull-bugs.md`

To customize, create override files in:

```
~/.config/opencode/makiso/prompts/
```

User overrides take precedence over defaults.

## Configuration

### Data Directory

All makiso data is stored in:

```
~/.config/opencode/makiso/
├── events.db          # SQLite database
├── plugin.log         # Debug logs (when OC_EVENTS_DEBUG=1)
├── last-event.txt     # Last processed event
└── prompts/           # Custom prompt overrides
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_EVENTS_TOPIC` | `inbox` | Default topic for polling |
| `OC_AGENT_ID` | `@opencode` | Agent identity for claiming events |
| `OC_EVENTS_POLL_INTERVAL_MS` | `60000` | Plugin polling interval |
| `OC_EVENTS_DEBUG` | (unset) | Set to `1` to enable debug logging |

### Webhook Server Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `OC_EVENTS_WEBHOOK_PORT` | `8787` | Server port |
| `OC_EVENTS_WEBHOOK_SECRET` | (none) | Secret for `x-oc-events-secret` header |
| `OC_EVENTS_WEBHOOK_ROUTES` | (none) | Route mapping (e.g., `alerts:inbox,ops:ops`) |
| `OC_EVENTS_WEBHOOK_SOURCE` | `webhook` | Source identifier for events |

## How It Works

### AI Event Execution Modes

#### Mode 1: Manual/On-Demand (Default)

Ask the AI to check for events:

- "Check for events"
- "Any pending tasks?"
- "Pull the next event"

The AI will run:

```bash
oc-events pull inbox --agent @opencode
```

If an event exists, the AI will:

1. Read the event body and topic system prompt
2. Execute the requested action
3. Reply with: `oc-events reply <event-id> --status completed --body "result"`

#### Mode 2: Automatic (Optional)

To make the AI check automatically at every turn, edit the skill file:

```
~/.config/opencode/skill/makiso/SKILL.md
```

Change the "Event Checking" section to include:

```markdown
## IMPORTANT: Automatic Event Checking

**At the start of EVERY conversation turn**, you MUST check for pending events...
```

#### Mode 3: Watch Command (Separate Terminal)

Monitor events in real-time:

```bash
oc-events watch inbox --agent @watcher
```

**Note:** Use a different agent ID (e.g., `@watcher`) to avoid claiming events meant for the AI.

## Quick Start

### 1. Start the event watcher (in a separate terminal)

```bash
oc-events watch inbox --agent @watcher
```

### 2. Push an event

```bash
oc-events push inbox --body "Deploy the new feature to staging" --source "ci-pipeline"
```

### 3. Reply to an event

```bash
oc-events reply <event-id> --status completed --body "Deployment successful"
```

## CLI Commands

### Event Management

| Command | Description |
|---------|-------------|
| `oc-events push <topic> --body "..."` | Publish an event |
| `oc-events pull <topic> --agent <id>` | Claim the next pending event |
| `oc-events reply <id> --status <status> --body "..."` | Reply and update status |
| `oc-events watch <topic> --agent <id>` | Watch for events in real-time |

### Search & Query

| Command | Description |
|---------|-------------|
| `oc-events search <query>` | Full-text search event bodies |
| `oc-events query --mention @name` | Find events mentioning someone |
| `oc-events query --tool <name>` | Find events with specific tool calls |

### Topics

| Command | Description |
|---------|-------------|
| `oc-events topics list` | List all topics |
| `oc-events topics create <name> --prompt "..."` | Create topic with system prompt |
| `oc-events topics set-prompt <name> --prompt-file <path>` | Set prompt from file |

### Maintenance

| Command | Description |
|---------|-------------|
| `oc-events cleanup` | Remove old events |

## Webhook Server

Start the webhook server:

```bash
OC_EVENTS_WEBHOOK_PORT=8787 \
OC_EVENTS_WEBHOOK_ROUTES='alerts:inbox,ops:ops' \
OC_EVENTS_WEBHOOK_SECRET='your-secret' \
oc-events-webhook
```

Send events via HTTP POST:

```bash
curl -X POST http://localhost:8787/alerts \
  -H "x-oc-events-secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"body":"Production server down!","severity":"critical"}'
```

## Disabling Event Checking

**Option 1: Remove the skill**

```bash
rm ~/.config/opencode/skill/makiso
```

**Option 2: Disable the plugin**
Remove from `~/.config/opencode/opencode.json`:

```json
"~/projects/opencode-makiso"
```

## Agent ID Conflicts

Events can only be claimed once. Use different agent IDs for different consumers:

- AI execution: `@opencode` (default)
- Watch monitoring: `@watcher`
- Manual testing: `@test`

## Repo Layout

```
opencode-makiso/
├── src/               # Core library, CLI, plugin, server
├── skill/             # OpenCode skill files
├── prompts/           # Default sub-command prompt templates
├── docs/              # PRD and design notes
└── dist/              # Build output
```
