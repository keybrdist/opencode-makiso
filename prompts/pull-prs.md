# Pull PRs for Review

Fetch open pull requests from Bitbucket that need attention and create events for each one.

## Instructions

1. **Load the bitbucket skill** to access PR data

2. **Fetch open PRs** where:
   - You are listed as a reviewer
   - Status is "OPEN"
   - No approval from you yet (or changes requested)

3. **For each PR needing review**, create an event:
   ```bash
   oc-events push inbox \
     --body "PR Review: <PR title> by <author>" \
     --source "bitbucket" \
     --meta '{"type":"pr-review","pr_id":"<id>","repo":"<repo>","url":"<pr-url>","author":"<author>"}'
   ```

4. **Report summary**:
   - Total PRs found
   - Events created
   - Any PRs skipped (already reviewed, etc.)

## Example Output

```
Found 3 open PRs assigned for review:
- PR #123: "Add user authentication" by @alice - Created event
- PR #125: "Fix pagination bug" by @bob - Created event  
- PR #128: "Update dependencies" by @charlie - Skipped (already approved)

Created 2 PR review events in inbox.
```

## Notes

- Only create events for PRs that actually need action
- Include the PR URL in metadata so you can easily open it
- If no PRs need review, report "No PRs pending review"
