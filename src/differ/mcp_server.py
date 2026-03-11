"""MCP server exposing Differ capabilities as tools."""

import json
import urllib.error
import urllib.request

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "differ",
    instructions="Interact with a local Differ instance (diff viewer with inline comments).",
)

BASE_URL = "http://localhost:5001"


def _request(method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if body else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except urllib.error.URLError as e:
        return 0, f"Connection error: {e.reason}"


def _json_request(method: str, path: str, body: dict | None = None) -> str:
    status, text = _request(method, path, body)
    if status == 0:
        return text
    try:
        data = json.loads(text)
        return json.dumps(data, indent=2)
    except json.JSONDecodeError:
        if status == 204:
            return "Done."
        return text or f"HTTP {status}"


# --- Repo management ---


@mcp.tool()
def list_repos() -> str:
    """List all configured repositories."""
    return _json_request("GET", "/api/repos")


@mcp.tool()
def add_repo(slug: str, path: str) -> str:
    """Add a repository. Slug must be alphanumeric+hyphens, path must exist on disk."""
    return _json_request("POST", "/api/repos", {"slug": slug, "path": path})


@mcp.tool()
def update_repo(slug: str, path: str) -> str:
    """Update a repository's path."""
    return _json_request("PUT", f"/api/repos/{slug}", {"path": path})


@mcp.tool()
def remove_repo(slug: str) -> str:
    """Remove a repository and its comments."""
    return _json_request("DELETE", f"/api/repos/{slug}")


# --- Diff ---


@mcp.tool()
def get_diff(repo: str) -> str:
    """Get the parsed git diff for a repo. Returns structured file/hunk/line data."""
    return _json_request("GET", f"/{repo}/api/diff")


# --- Comments ---


@mcp.tool()
def list_comments(repo: str, file: str | None = None) -> str:
    """List comments for a repo, optionally filtered by file path."""
    path = f"/{repo}/api/comments"
    if file:
        path += f"?file={urllib.request.quote(file)}"
    return _json_request("GET", path)


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
    return _json_request(
        "POST",
        f"/{repo}/api/comments",
        {
            "file": file,
            "side": side,
            "start_line": start_line,
            "end_line": end_line,
            "body": body,
            "author": author,
        },
    )


@mcp.tool()
def update_comment(repo: str, comment_id: str, body: str) -> str:
    """Update a comment's body text."""
    return _json_request("PUT", f"/{repo}/api/comments/{comment_id}", {"body": body})


@mcp.tool()
def delete_comment(repo: str, comment_id: str) -> str:
    """Delete a single comment."""
    return _json_request("DELETE", f"/{repo}/api/comments/{comment_id}")


@mcp.tool()
def clear_comments(repo: str) -> str:
    """Clear all comments for a repo."""
    return _json_request("DELETE", f"/{repo}/api/comments")


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
