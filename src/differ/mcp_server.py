"""MCP server exposing read-only Differ capabilities as tools.

Operates directly on the in-memory state in app.py — no HTTP proxy.
Started automatically as a background thread when the Flask app runs.
"""

import json

from mcp.server.fastmcp import FastMCP

from differ import app as differ_app

MCP_PORT = 5002

mcp = FastMCP(
    "differ",
    instructions="Read-only access to a local Differ instance (diff viewer with inline comments).",
    port=MCP_PORT,
)


def _fmt(obj: object) -> str:
    return json.dumps(obj, indent=2)


@mcp.tool()
def list_repos() -> str:
    """List all configured repositories."""
    return _fmt([{"slug": s, "path": p} for s, p in differ_app.REPOS.items()])


@mcp.tool()
def get_diff(repo: str) -> str:
    """Get the parsed git diff for a repo. Returns structured file/hunk/line data."""
    path = differ_app.REPOS.get(repo)
    if not path:
        return _fmt({"error": f"Unknown repo: {repo}"})
    diff_text = differ_app.get_diff(path)
    parsed = differ_app.parse_diff(diff_text)
    return _fmt(parsed)


@mcp.tool()
def list_comments(repo: str, file: str | None = None) -> str:
    """List comments for a repo, optionally filtered by file path."""
    if repo not in differ_app.REPOS:
        return _fmt({"error": f"Unknown repo: {repo}"})
    repo_comments = differ_app.comments.get(repo, {})
    if file:
        repo_comments = {k: v for k, v in repo_comments.items() if v["file"] == file}
    return _fmt(list(repo_comments.values()))


def run_mcp() -> None:
    """Start the MCP server with streamable HTTP transport."""
    mcp.run(transport="streamable-http")


def main() -> None:
    run_mcp()


if __name__ == "__main__":
    main()
