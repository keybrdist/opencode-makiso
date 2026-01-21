# Install Makiso

**One command - no dependencies required:**

```bash
mkdir -p ~/.config/opencode/skill/makiso && \
curl -sL https://raw.githubusercontent.com/keybrdist/opencode-makiso/main/skill/SKILL.md \
  -o ~/.config/opencode/skill/makiso/SKILL.md
```

That's it! Restart OpenCode and say **"check events"** to get started.

The skill will auto-bootstrap the SQLite database on first use.

---

## What Gets Installed

- `~/.config/opencode/skill/makiso/SKILL.md` - The skill file (only file needed)
- `~/.config/opencode/makiso/events.db` - SQLite database (created on first use)

## Requirements

- `sqlite3` command (pre-installed on macOS and most Linux distros)
- No Node.js, npm, or build tools required

## Optional: Full CLI

For power users who want the full CLI with better error messages:

```bash
git clone https://github.com/keybrdist/opencode-makiso.git
cd opencode-makiso
npm install && npm run build && npm link
```

This makes `oc-events` available globally. The skill will automatically use the CLI when available.

## Uninstall

```bash
rm -rf ~/.config/opencode/skill/makiso
rm -rf ~/.config/opencode/makiso  # Removes database too
```
