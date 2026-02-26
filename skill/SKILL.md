---
name: makiso
description: Publish, pull, search, and reply to OpenCode events with PR/Jira integration
argument-hint: e.g. "check events", ".check-prs", ".check-jira", ".checkbugs"
---

# OpenCode Makiso

A local-first pub/sub system for coordinating LLM agents with events stored in SQLite.
Enhanced with PR comment awareness, Jira status tracking, and workflow routing.

**Name origin:** "Make it so"

## First-Time Setup (Auto-Bootstrap)

When you see `oc-events: command not found`, bootstrap using inline SQL. The skill works with just `sqlite3` (pre-installed on macOS/Linux).

### Step 1: Create data directory
```bash
mkdir -p ~/.config/opencode/makiso
```

### Step 2: Initialize database
```bash
sqlite3 ~/.config/opencode/makiso/events.db "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata TEXT,
  correlation_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'agent',
  org_id TEXT,
  workspace_id TEXT,
  project_id TEXT,
  repo_id TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  claimed_by TEXT,
  claimed_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic, status);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_claimed_by ON events(claimed_by);
CREATE INDEX IF NOT EXISTS idx_events_org_topic_status_created ON events(org_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_workspace_topic_status_created ON events(org_id, workspace_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_project_topic_status_created ON events(org_id, project_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_repo_topic_status_created ON events(org_id, repo_id, topic, status, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  body,
  content='events',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO events_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TABLE IF NOT EXISTS topics (
  name TEXT PRIMARY KEY,
  system_prompt TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mentions (
  event_id TEXT NOT NULL,
  mention TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mentions_mention ON mentions(mention);

CREATE TABLE IF NOT EXISTS tool_calls (
  event_id TEXT NOT NULL,
  tool_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
"
```

### Verify Setup
```bash
sqlite3 ~/.config/opencode/makiso/events.db "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected output: `metadata`, `events`, `topics`, `mentions`, `tool_calls`

---

## Command Detection

Before running commands, check if CLI is available:

```bash
if command -v oc-events &>/dev/null; then
  # Use CLI (preferred)
  oc-events push inbox --body "test" --org acme --repo lgapi
else
  # Use inline SQL (fallback)
  sqlite3 ~/.config/opencode/makiso/events.db "INSERT INTO events..."
fi
```

**Preference order:** Use CLI when available; fall back to inline SQL otherwise.

---

## Automatic Skill Trigger

**Load this skill IMMEDIATELY when user says:**

| Trigger Phrase | Action |
|----------------|--------|
| "check events" | Load skill, run Step 1-3 |
| "any pending tasks?" | Load skill, run Step 1-3 |
| "check event" | Load skill, run Step 1-3 |
| "pending events" | Load skill, run Step 1-3 |
| "events" | Load skill, run Step 1-3 |
| ".check-prs", ".checkprs" | Run `.check-prs` sub-command |
| ".check-jira", ".checkjira" | Run `.check-jira` sub-command |
| ".checkbugs", ".check-bugs" | Run `.checkbugs` sub-command |
| ".checkall", ".check-all" | Run `.checkall` sub-command |
| ".pullprs", ".pulljira", ".pullbugs" | Run legacy sub-commands |

**Do NOT:**
- Use laravel-boost tools for log checking when user says "check events"
- Guess what "events" means - load makiso skill first
- Ask user to clarify - just load the skill

**Do:**
- Load skill immediately on trigger phrases
- Use `oc-events` CLI commands
- Use Bitbucket MCP for PR context
- Use Atlassian MCP for Jira context

## Enhanced Event Checking

When the user asks you to check for events (e.g., "check events", "any pending tasks?"):

### Scope First
```bash
# Use saved context when available (preferred)
oc-events context show

# Or set explicit scope once per repo/session
oc-events context set --org acme --workspace platform --project distribution --repo lgapi
```

### Step 1: Check inbox first
```bash
oc-events pull inbox --agent @opencode --scope repo
```

### Step 2: If inbox empty, check all topics for pending events
```bash
# Query pending events in the same org/repo:
sqlite3 ~/.config/opencode/makiso/events.db "SELECT id, topic, substr(body, 1, 100), status FROM events WHERE org_id = 'acme' AND repo_id = 'lgapi' AND status = 'pending' ORDER BY created_at DESC LIMIT 20"
```

**IMPORTANT**: Always run Step 2 when inbox is empty. Do NOT tell the user "No events found" after only checking the inbox.

### Step 3: Enrich events with PR/Jira context (NEW)
For each pending event, check for linked PR and Jira status:

```bash
# Extract Jira key (DEV-XXXX) from event body
EVENT_BODY=$(sqlite3 ~/.config/opencode/makiso/events.db "SELECT body FROM events WHERE id = '$EVENT_ID'")
echo "$EVENT_BODY" | grep -oE 'DEV-[0-9]+'

# Check Jira status via Atlassian MCP
atlantide jira get-issue <JIRA_KEY> --fields status

# Check PR comments via Bitbucket MCP
bb pullrequest comment list --pullrequest <PR_NUMBER>
```

### Step 4: Process with routing (NEW)
Based on PR/Jira state, route events to appropriate actions:

| State | Route | Action |
|-------|-------|--------|
| PR has unresolved comments | `needs-review` | Address comments before proceeding |
| PR merged, LLM PROMPT exists | `needs-testing` | Execute testing instructions |
| PR approved, no blockers | `ready-to-merge` | Merge PR |
| Jira in "QA" status | `qa-testing` | Run verification tests |
| Jira in "Prod. Deploy" | `production-deploy` | Create/deploy tag |

### Processing Events
If an event is returned:
1. Read the event body carefully
2. Extract PR number and/or Jira key from body
3. Check PR comments and Jira status
4. Determine appropriate route
5. Execute the requested action
6. Reply with: `oc-events reply <event-id> --status completed --body "your response"`

**Only after checking BOTH inbox AND database**: If no events are found in inbox (Step 1) AND no pending events in database (Step 2), then inform the user there are no pending events.

## Sub-Commands (Event Sources)

The following sub-commands fetch data from external sources and create events automatically.

### .check-prs - Check PRs with Full Context (ENHANCED)

When the user says `.check-prs`, `.pullprs`, `check prs`, or `pull prs`:

1. **Fetch open PRs from Bitbucket**
   ```bash
   bb pullrequest list --state open --output json
   ```

2. **For each PR, enrich with context**
   ```bash
   # Get PR details
   bb pullrequest get <PR_NUMBER>

   # Get comment count and unresolved reviewers
   bb pullrequest comment list --pullrequest <PR_NUMBER>

   # Check CodeRabbit review status (look for @coderabbitai comments)

   # Detect LLM PROMPT in PR description or comments
   ```

3. **Create events based on PR state**
   - **Needs Review**: Open PRs with no recent activity (>24h)
   - **Has Comments**: PRs with unresolved reviewer comments
   - **Ready to Merge**: PRs that are approved and ready
   - **Needs Testing**: Merged PRs with LLM PROMPT instructions

4. **Example event body with metadata**
   ```
   PR Review: {title}
   PR: #{number} ({state})
   Link: {pr_link}

   State: {open|merged|approved|needs_changes}
   Comments: {count} unresolved
   LLM PROMPT: {detected|none}
   Reviewers: {reviewer_list}

   Recommended Route: {needs-review|ready-to-merge|needs-testing}
   ```

5. **Report summary**
   ```
   **PR Summary:**
   - 3 open PRs needing review
   - 1 PR ready to merge
   - 2 PRs have unresolved comments
   ```

### .check-jira - Check Jira Issues (NEW)

When the user says `.check-jira`, `.checkjira`, `check jira`, `.pulljira`, `pull jiras`, `check issues`, or `pull issues`:

1. **Fetch user's assigned issues from Jira**
   ```bash
   # Using Atlassian MCP
   atlan jira search --jql "assignee = currentUser() AND status NOT IN (Done, Canceled)"

   # Or using bb CLI
   bb pullrequest list --state open --output json | grep -i "DEV-[0-9]"
   ```

2. **For each issue, check linked PR and state**
   ```bash
   # Get issue details
   bb pullrequest get <PR_NUMBER>

   # Check PR comments
   bb pullrequest comment list --pullrequest <PR_NUMBER>

   # Check for LLM PROMPT
   ```

3. **Create events based on Jira state**
   - **PR Stage**: Issues in "PR" status - check PR comments
   - **QA Stage**: Issues in "QA" status - run tests
   - **Prod Deploy**: Issues in "Prod. Deploy" status - deploy to production
   - **Blocked**: Issues with failed tests or rejected reviews

4. **Example event body**
   ```
   Jira Action Required: {summary}
   Jira: {key} ({status})
   Link: {jira_link}

   PR: #{number} ({state})
   Comments: {count} unresolved
   LLM PROMPT: {detected|none}

   Recommended Route: {needs-review|qa-testing|production-deploy}
   ```

5. **Report summary**
   ```
   **Jira Summary:**
   - 2 issues in PR stage
   - 1 issue in QA stage
   - 1 issue ready for Prod Deploy
   ```

### .checkbugs - Check Bugsnag Errors

When the user says `.checkbugs`, `.check-bugs`, `.pullbugs`, `check bugs`, `check errors`, or `pull bugs`:

1. **Fetch recent errors from Bugsnag**
   - Use bugsnag skill to fetch errors
   - Prioritize by frequency and severity

2. **For each error, check if linked Jira exists**
   ```bash
   # Extract error code from Bugsnag
   ERROR_CODE=$(echo "$error_title" | grep -oE 'DEV-[0-9]+')

   # Check Jira status
   bb pullrequest list --state open | grep "$ERROR_CODE"
   ```

3. **Create events for high-impact errors**
   - New errors without investigation
   - High-frequency recurring errors
   - Errors linked to open Jira tickets

4. **Report summary**

#### Time Window Strategy

Start narrow, expand if needed:

1. **First pass:** Last 24 hours (--since "24 hours ago")
   - Quick wins, recent regressions

2. **Second pass:** Last 7 days (--since "7 days ago")
   - Persistent issues, higher event counts

3. **Volume threshold:**
   - 24h window: 10+ events = investigate
   - 7d window: 50+ events = critical
   - 30d window: 500+ events = systemic issue

#### Consolidation Analysis for High-Volume Errors

When dealing with 10+ Bugsnag errors, use consolidation strategy:

1. **Group by file/responsibility:**
   - Same file = same PR
   - Same DSP integration = same PR
   - Same subsystem (S3, Redis, validation) = same PR

2. **Priority ranking:**
   - Event volume (1000+ = critical)
   - Severity (error > warning)
   - Impact (user-facing > background jobs)

3. **Cross-check recent commits:**
   ```bash
   # Check if fix already exists locally
   git log --since="2 weeks ago" --grep="DEV-XXXX"
   git branch -a | grep -iE "(fix|hotfix|bugfix)"
   ```

4. **Create consolidated PR events:**
   - Topic: `pr-consolidation-{theme}` (e.g., pr-consolidation-critical-errors)
   - Body: List all related DEV-XXX, files, priority
   - Meta: `{"priority": 1-8, "issue_count": N, "event_count": N}`

5. **Benefits:**
   - Reduce 20+ PRs to 5-8 themed PRs
   - 60-70% reduction in review time
   - Related fixes reviewed together

### .checkall - Check All Sources

When the user says `.checkall`, `.check-all`, `.pullall`, or `check all`:

Execute all sub-commands in sequence:
1. `.check-prs`
2. `.check-jira`
3. `.checkbugs`

Report combined summary with unified routing recommendations.

## Core Commands (CLI or Inline SQL)

Use CLI when available; inline SQL as fallback. Database path: `~/.config/opencode/makiso/events.db`

### Set Scope Context
```bash
oc-events context set --org acme --workspace platform --project distribution --repo lgapi
oc-events context show
```

### Agent Handoff Between LLMs
```bash
# Create a handoff and emit copy-paste prompt
oc-events handoff push \
  --to claude \
  --from codex \
  --summary "Finished queue routing changes" \
  --goal "Run validation and open PR" \
  --next "Run tests,Fix failures,Open PR" \
  --files "src/cli.ts,src/db/events.ts" \
  --copy

# Pull handoff for target agent
oc-events handoff pull --for claude --agent @claude --scope repo --copy
```

Use this when switching from one coding agent to another and you want a clean first prompt.

### Push Event
```bash
# CLI (preferred)
oc-events push <topic> --body "message" --org acme --workspace platform --project distribution --repo lgapi

# Inline SQL (fallback)
sqlite3 ~/.config/opencode/makiso/events.db \
  "INSERT INTO events (id, topic, body, status, source, org_id, workspace_id, project_id, repo_id, created_at)
   VALUES ('$(date +%s)-$$', '<topic>', 'message', 'pending', 'skill', 'acme', 'platform', 'distribution', 'lgapi', $(date +%s)000)"
```

### Pull Event (claim next pending)
```bash
# CLI (preferred)
oc-events pull <topic> --agent "@opencode" --org acme --repo lgapi --scope repo

# Inline SQL (fallback) - claim and return in one query
sqlite3 -json ~/.config/opencode/makiso/events.db \
  "UPDATE events SET status='processing', claimed_by='@opencode', claimed_at=$(date +%s)000
   WHERE id = (SELECT id FROM events WHERE topic='<topic>' AND org_id='acme' AND repo_id='lgapi' AND status='pending'
   ORDER BY created_at LIMIT 1) RETURNING *"
```

### Reply to Event
```bash
# CLI (preferred)
oc-events reply <id> --status completed --body "result summary"

# Inline SQL (fallback)
sqlite3 ~/.config/opencode/makiso/events.db \
  "UPDATE events SET status='completed', processed_at=$(date +%s)000,
   metadata=json_set(COALESCE(metadata,'{}'), '$.reply', 'result summary')
   WHERE id='<id>'"
```

Use `--status failed` or `status='failed'` for failures.

### Search Events
```bash
# CLI (preferred)
oc-events search "text query" --org acme --scope org

# Inline SQL (fallback)
sqlite3 -json ~/.config/opencode/makiso/events.db \
  "SELECT e.* FROM events e
   JOIN events_fts fts ON e.rowid = fts.rowid
   WHERE events_fts MATCH 'text query' AND e.org_id='acme'
   ORDER BY e.created_at DESC LIMIT 20"
```

### Query by Status/Topic
```bash
# CLI (preferred)
oc-events pull inbox --agent "@opencode" --org acme --repo lgapi --scope repo

# Inline SQL (fallback)
sqlite3 -json ~/.config/opencode/makiso/events.db \
  "SELECT id, topic, substr(body, 1, 100) as body_preview, status, created_at
   FROM events WHERE topic='inbox' AND org_id='acme' AND repo_id='lgapi' AND status='pending'
   ORDER BY created_at DESC LIMIT 20"
```

### List All Pending Events
```bash
# Inline SQL (works with or without CLI)
sqlite3 ~/.config/opencode/makiso/events.db \
  "SELECT id, topic, substr(body, 1, 80), status FROM events
   WHERE org_id='acme' AND repo_id='lgapi' AND status = 'pending' ORDER BY created_at DESC LIMIT 20"
```

### Topics Management
```bash
# CLI (preferred)
oc-events topics list
oc-events topics create <topic> --prompt "..." --description "..."

# Inline SQL (fallback)
sqlite3 -json ~/.config/opencode/makiso/events.db "SELECT * FROM topics"
sqlite3 ~/.config/opencode/makiso/events.db \
  "INSERT INTO topics (name, system_prompt, description, created_at)
   VALUES ('<topic>', 'prompt text', 'description', $(date +%s)000)"
```

### Cleanup Old Events
```bash
# CLI (preferred)
oc-events cleanup --completed-days 30 --pending-days 7

# Inline SQL (fallback) - delete completed older than 30 days
sqlite3 ~/.config/opencode/makiso/events.db \
  "DELETE FROM events WHERE status='completed'
   AND created_at < ($(date +%s) - 30*86400) * 1000"
```

## Investigation Patterns

### Cross-Check Recent Commits for Bugsnag Errors

Before creating new PR events, verify if fix already exists:

```bash
# 1. Extract error pattern from Bugsnag
ERROR_KEY="DEV-1831"
ERROR_PATTERN="invalid.*wav|mp3.*validation"

# 2. Search recent commits
git log --since="2 weeks ago" --all --oneline --grep="$ERROR_KEY"
git log --since="2 weeks ago" --all -p | grep -iE "$ERROR_PATTERN"

# 3. Check local unmerged branches
git branch | grep -iE "(fix|hotfix|bugfix)"
git log main..branch-name --oneline

# 4. If fix found, route to deployment instead of new PR
```

**Common scenarios:**
- Fix exists but never pushed → Route: push-and-pr
- Fix on remote branch not merged → Route: needs-review
- Fix merged to main not deployed → Route: production-deploy

### Topic Naming Conventions

For Bugsnag-driven workflows:

| Pattern | Use Case | Example |
|---------|----------|---------|
| `bugsnag-investigation` | Individual error analysis | Single DEV-XXXX deep dive |
| `investigation-{key}-cross-check` | Commit verification | investigation-dev-1831-cross-check |
| `pr-consolidation-{theme}` | Grouped PR planning | pr-consolidation-critical-errors |
| `{subsystem}-incident` | Multi-error incident | audio-processing-incident |
| `pr-refinement-analysis` | Consolidation review | Overlap detection, priority adjustment |
| `plugin-management` | Plugin improvements | Feature requests, refactoring |
| `plugin-feature-request` | New slash commands | Workflow automation ideas |

## Workflow Integration

### Resume-Workflow Routing

When processing events, use resume-workflow patterns:

| Scenario | Check | Action |
|----------|-------|--------|
| PR has comments | `bb pullrequest comment list --pullrequest <PR>` | Route: needs-review |
| PR approved | `bb pullrequest get <PR>` | Route: ready-to-merge |
| LLM PROMPT exists | Check PR description/comments | Route: needs-testing |
| Jira in QA | `atlan jira get-issue <KEY>` | Route: qa-testing |
| Jira in Prod Deploy | Check deployment status | Route: production-deploy |

### Example Event Processing Flow

```
Event: PR Review: Fix implode error in Bandcamp
PR: #1906 (OPEN)
Comments: 0 unresolved

1. Check PR comments: bb pullrequest comment list --pullrequest 1906
   → Result: No unresolved comments

2. Check PR state: bb pullrequest get 1906
   → Result: OPEN, needs_reviewers

3. Determine route: Ready to merge → Route D

4. Execute: Propose merge to developer
```

## Configuration

- Data directory: `~/.config/opencode/makiso/`
- Prompts directory: `~/.config/opencode/makiso/prompts/`
- Database: `~/.config/opencode/makiso/events.db`

Environment variables (for CLI, optional):
- `OC_AGENT_ID` - Agent identity (default: `@opencode`)
