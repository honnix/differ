# Differ

GitHub-style diff viewer with inline comments — designed for human-in-the-loop code review with AI agents.

## Why Differ?

When working with coding agents (Claude Code, etc.), you often want to review changes before committing. Differ lets you:

1. **View the agent's changes** in a familiar split/unified diff UI
2. **Leave inline comments** on specific lines or entire files — just like a GitHub PR review
3. **Have the agent read and address your comments** via the API, creating a tight review loop without leaving your terminal

The comment API (`GET /<repo>/api/comments`) is designed to be consumed by agents. Point your agent at the comments endpoint, and it can read your feedback and iterate on the code autonomously.

<img width="1895" height="1454" alt="screenshot" src="https://github.com/user-attachments/assets/3d55f5cf-39f9-41cb-a857-89b72658c960" />

## Quick start

```bash
uv run differ [/path/to/repo]
```

See [CLAUDE.md](CLAUDE.md) for full API and development documentation.
