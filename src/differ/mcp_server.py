"""MCP server exposing Differ capabilities as tools.

Operates directly on the in-memory state in app.py — no HTTP proxy.
Started automatically as a background thread when the Flask app runs.
"""

import json
import os
import uuid
from datetime import datetime, timezone

from mcp.server.fastmcp import FastMCP

from differ import app as differ_app

mcp = FastMCP(
    "differ",
    instructions="Interact with a local Differ instance (diff viewer with inline comments).",
)


def _fmt(obj: object) -> str:
    return json.dumps(obj, indent=2)


# --- Repo management ---


@mcp.tool()
def list_repos() -> str:
    """List all configured repositories."""
    return _fmt([{"slug": s, "path": p} for s, p in differ_app.REPOS.items()])


@mcp.tool()
def add_repo(slug: str, path: str) -> str:
    """Add a repository. Slug must be alphanumeric+hyphens, path must exist on disk."""
    slug = slug.strip()
    path = path.strip()
    if not slug or not differ_app.SLUG_RE.match(slug):
        return _fmt({"error": "slug must be non-empty alphanumeric with hyphens"})
    if not path or not os.path.isdir(path):
        return _fmt({"error": "path must be an existing directory"})
    if slug in differ_app.REPOS:
        return _fmt({"error": f"Repo '{slug}' already exists"})
    differ_app.REPOS[slug] = path
    return _fmt({"slug": slug, "path": path})


@mcp.tool()
def update_repo(slug: str, path: str) -> str:
    """Update a repository's path."""
    path = path.strip()
    if slug not in differ_app.REPOS:
        return _fmt({"error": f"Repo '{slug}' not found"})
    if not path or not os.path.isdir(path):
        return _fmt({"error": "path must be an existing directory"})
    differ_app.REPOS[slug] = path
    return _fmt({"slug": slug, "path": path})


@mcp.tool()
def remove_repo(slug: str) -> str:
    """Remove a repository and its comments."""
    if slug not in differ_app.REPOS:
        return _fmt({"error": f"Repo '{slug}' not found"})
    del differ_app.REPOS[slug]
    differ_app.comments.pop(slug, None)
    return "Done."


# --- Diff ---


@mcp.tool()
def get_diff(repo: str) -> str:
    """Get the parsed git diff for a repo. Returns structured file/hunk/line data."""
    path = differ_app.REPOS.get(repo)
    if not path:
        return _fmt({"error": f"Unknown repo: {repo}"})
    diff_text = differ_app.get_diff(path)
    parsed = differ_app.parse_diff(diff_text)
    return _fmt(parsed)


# --- Comments ---


@mcp.tool()
def list_comments(repo: str, file: str | None = None) -> str:
    """List comments for a repo, optionally filtered by file path."""
    if repo not in differ_app.REPOS:
        return _fmt({"error": f"Unknown repo: {repo}"})
    repo_comments = differ_app.comments.get(repo, {})
    if file:
        repo_comments = {k: v for k, v in repo_comments.items() if v["file"] == file}
    return _fmt(list(repo_comments.values()))


@mcp.tool()
def create_comment(
    repo: str,
    file: str,
    side: str,
    start_line: int,
    end_line: int,
    body: str,
    author: str = "claude",
) -> str:
    """Create an inline comment on a diff.

    Args:
        repo: Repository slug
        file: File path within the diff
        side: 'left' (old/deleted) or 'right' (new/added)
        start_line: First line of the comment range
        end_line: Last line of the comment range
        body: Comment text
        author: Comment author name
    """
    if repo not in differ_app.REPOS:
        return _fmt({"error": f"Unknown repo: {repo}"})
    comment_id = str(uuid.uuid4())
    comment = {
        "id": comment_id,
        "file": file,
        "side": side,
        "start_line": start_line,
        "end_line": end_line,
        "body": body,
        "author": author,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    differ_app.comments.setdefault(repo, {})[comment_id] = comment
    return _fmt(comment)


@mcp.tool()
def update_comment(repo: str, comment_id: str, body: str) -> str:
    """Update a comment's body text."""
    comment = differ_app.comments.get(repo, {}).get(comment_id)
    if not comment:
        return _fmt({"error": "Comment not found"})
    comment["body"] = body
    return _fmt(comment)


@mcp.tool()
def delete_comment(repo: str, comment_id: str) -> str:
    """Delete a single comment."""
    repo_comments = differ_app.comments.get(repo, {})
    if comment_id not in repo_comments:
        return _fmt({"error": "Comment not found"})
    del repo_comments[comment_id]
    return "Done."


@mcp.tool()
def clear_comments(repo: str) -> str:
    """Clear all comments for a repo."""
    differ_app.comments.pop(repo, None)
    return "Done."


def run_mcp(port: int = 5002) -> None:
    """Start the MCP server with SSE transport."""
    mcp.run(transport="sse", port=port)


def main() -> None:
    run_mcp()


if __name__ == "__main__":
    main()
