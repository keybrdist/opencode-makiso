---
name: makiso
description: Publish, pull, search, and reply to OpenCode events with PR/Jira integration
argument-hint: e.g. "check events", ".check-prs", ".check-jira", ".checkbugs"
---

# OpenCode Makiso

A local-first pub/sub system for coordinating LLM agents with events stored in SQLite.
Enhanced with PR comment awareness, Jira status tracking, and workflow routing.

**Name origin:** "Make it so"

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

### Step 1: Check inbox first
```bash
oc-events pull inbox --agent @opencode
```

### Step 2: If inbox empty, check all topics for pending events
```bash
# Query all pending events from database:
sqlite3 ~/.config/opencode/makiso/events.db "SELECT id, topic, substr(body, 1, 100), status FROM events WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20"
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

## Core Commands

### Publish
- `oc-events push <topic> --body "..."`
- Optional: `--meta '{"pr":123,"jira":"DEV-1828","route":"needs-testing"}' --source <source> --correlation-id <id>`

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
- Debug log: `~/.config/opencode/makiso/plugin.log`

Environment variables:
- `OC_AGENT_ID` - Agent identity (default: `@opencode`)
- `OC_EVENTS_TOPIC` - Plugin polling topic (default: `inbox`)
- `OC_EVENTS_POLL_INTERVAL_MS` - Polling interval (default: `60000`)
- `OC_EVENTS_DEBUG` - Enable debug logging (set to `1`)
