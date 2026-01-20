# Pull Bugsnag Errors

Fetch recent errors from Bugsnag that need investigation and create events for high-impact issues.

## Instructions

1. **Load the bugsnag skill** to access error data

2. **Fetch errors** where:
   - Occurred in the last 24-48 hours
   - Status is "open" (not resolved/ignored)
   - High frequency (affected multiple users) OR high severity
   - Not already linked to a Jira issue marked as "Done"

3. **For each error needing attention**, create an event:
   ```bash
   oc-events push inbox \
     --body "Bug: <error class> - <error message (truncated)>" \
     --source "bugsnag" \
     --meta '{"type":"bug","error_id":"<id>","error_class":"<class>","count":"<occurrence_count>","users_affected":"<count>","url":"<bugsnag-url>"}'
   ```

4. **Report summary**:
   - Total errors found
   - Events created by severity
   - Any errors skipped (already resolved, linked to done tickets, etc.)

## Example Output

```
Found 8 open errors in the last 24 hours:

Critical (3):
- NullPointerException in UserService.authenticate (1,234 occurrences, 89 users) - Created event
- DatabaseConnectionError in OrderRepository (567 occurrences, 45 users) - Created event
- TimeoutException in PaymentGateway (234 occurrences, 23 users) - Created event

Warning (2):
- ValidationError in FormHandler (45 occurrences, 12 users) - Created event
- CacheExpiredException in SessionManager (23 occurrences, 8 users) - Skipped (linked to LIN-456 Done)

Info (3):
- Skipped (low severity)

Created 4 bug events in inbox.
```

## Notes

- Focus on errors affecting multiple users
- Include occurrence count to help prioritize
- Check if error is already linked to a resolved issue before creating event
- Truncate long error messages in the event body (full details in Bugsnag URL)
