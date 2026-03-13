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
  templates/
    repos.html        # Repo management page (index)
    index.html        # Diff viewer for a single repo
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

| Method | Path                                    | Purpose                          |
|--------|-----------------------------------------|----------------------------------|
| GET    | `/<repo>/api/diff`                      | Get parsed git diff              |
| GET    | `/<repo>/api/file-lines`                | Get lines from working tree file |
| GET    | `/<repo>/api/comments`                  | List comments                    |
| POST   | `/<repo>/api/comments`                  | Create comment                   |
| GET    | `/<repo>/api/comments/<id>`             | Get comment                      |
| PUT    | `/<repo>/api/comments/<id>`             | Update comment body              |
| DELETE | `/<repo>/api/comments/<id>`             | Delete comment                   |
| DELETE | `/<repo>/api/comments`                  | Clear all repo comments          |

`GET /<repo>/api/file-lines?path=<file>&start=<line>&end=<line>` — returns `{lines, start, end, total_lines}`. Used by the expand-hidden-lines feature.

`GET /<repo>/api/diff` response includes `new_total_lines` per file (line count of the working tree file).

Comments use `side` = `"left"` | `"right"` | `"file"`. File-level comments use `side: "file"`, `start_line: 0`, `end_line: 0`.

## UI features

- **Split / Unified view** toggle (defaults to split)
- **File search** panel with fuzzy filtering (`Cmd+P` / `Ctrl+P` to focus)
- **Syntax highlighting** via highlight.js (language detected from file extension)
- **Expand hidden lines** between diff hunks (GitHub-style up/down/all controls)
- **Inline comments**: click a line number to select, shift+click to extend range, then click `+` to comment
- **File-level comments**: click 💬 in the file header
- **Edit / Delete** comments inline
- **Clear comments** button: deletes all comments (with confirmation)

## Development

```bash
# Run all checks (lint + typecheck)
uv run --with tox-uv tox

# Run with auto-reload
uv run differ
```

Repo mappings are persisted to `~/.config/differ/repos.json` (override with `DIFFER_REPOS_FILE` env var). Comments are in-memory only.
