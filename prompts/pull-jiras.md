# Pull Jira/Linear Issues

Fetch issues from Linear (or Jira via Atlassian) that are assigned to you and need attention.

## Instructions

1. **Load the linear skill** (or atlassian skill for Jira) to access issue data

2. **Fetch issues** where:
   - Assigned to you
   - Status is "Todo", "In Progress", or "Backlog"
   - Not blocked by other issues
   - Priority is Medium or higher (optional filter)

3. **For each issue needing attention**, create an event:
   ```bash
   oc-events push inbox \
     --body "Issue: [<issue-id>] <title>" \
     --source "linear" \
     --meta '{"type":"issue","issue_id":"<id>","status":"<status>","priority":"<priority>","url":"<issue-url>"}'
   ```

4. **Report summary**:
   - Total issues found
   - Events created by status/priority
   - Any issues skipped

## Example Output

```
Found 5 issues assigned to you:

High Priority:
- LIN-234: "Fix authentication timeout" (In Progress) - Created event
- LIN-256: "Database migration failing" (Todo) - Created event

Medium Priority:
- LIN-267: "Update user dashboard" (Todo) - Created event
- LIN-289: "Add export functionality" (Backlog) - Created event

Low Priority:
- LIN-301: "Update README" (Backlog) - Skipped (low priority)

Created 4 issue events in inbox.
```

## Notes

- Prioritize high-priority and in-progress items
- Include issue URL for quick access
- If using Jira instead of Linear, adjust the skill accordingly
- Group output by priority for better visibility
