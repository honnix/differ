# Differ

GitHub-style PR diff viewer with inline comments.

## Quick start

```bash
uv run differ [/path/to/repo]
```

- With a path argument: starts in single-repo mode (slug `default`)
- Without arguments: starts with no repos; add them via the web UI at `/`

Server runs on http://localhost:5001.

## Project structure

```
src/differ/
  app.py              # Flask app — all routes and logic
  mcp_server.py       # MCP server — exposes Differ API as tools
  templates/
    repos.html        # Repo management page (index)
    index.html        # Diff viewer for a single repo
.mcp.json             # MCP server config for Claude Code
```

## API

### Repo management

| Method | Path                 | Body            | Purpose              |
|--------|----------------------|-----------------|----------------------|
| GET    | `/api/repos`         | —               | List all repos       |
| POST   | `/api/repos`         | `{slug, path}`  | Add a repo           |
| PUT    | `/api/repos/<slug>`  | `{path}`        | Update a repo's path |
| DELETE | `/api/repos/<slug>`  | —               | Remove a repo        |

Slug must be alphanumeric + hyphens. Path must be an existing directory on disk.

### Diff & comments

| Method | Path                                    | Purpose                   |
|--------|-----------------------------------------|---------------------------|
| GET    | `/<repo>/api/diff`                      | Get parsed git diff       |
| GET    | `/<repo>/api/comments`                  | List comments             |
| POST   | `/<repo>/api/comments`                  | Create comment            |
| GET    | `/<repo>/api/comments/<id>`             | Get comment               |
| PUT    | `/<repo>/api/comments/<id>`             | Update comment body       |
| DELETE | `/<repo>/api/comments/<id>`             | Delete comment            |
| DELETE | `/<repo>/api/comments`                  | Clear all repo comments   |

## UI features

- **Split / Unified view** toggle (defaults to split)
- **File search** panel with fuzzy filtering (`Cmd+P` / `Ctrl+P` to focus)
- **Syntax highlighting** via highlight.js (language detected from file extension)
- **Inline comments**: click a line number to select, shift+click to extend range, then click `+` to comment
- **Edit / Delete** comments inline
- **Reload** button: re-fetches the diff and clears all comments

## MCP integration

`uv run differ` starts both the web UI (port 5001) and an MCP SSE server (port 5002) in the same process, sharing in-memory state. Claude Code auto-connects via `.mcp.json` → `http://localhost:5002/sse`.

Tools: `list_repos`, `add_repo`, `update_repo`, `remove_repo`, `get_diff`, `list_comments`, `create_comment`, `update_comment`, `delete_comment`, `clear_comments`.

## Development

```bash
# Lint and format
ruff check src/
ruff format --check src/

# Run with auto-reload
uv run differ
```

All state (repos and comments) is in-memory — nothing persists across restarts.
