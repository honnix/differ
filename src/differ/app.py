import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, Response, abort, jsonify, render_template, request

SLUG_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$")

app = Flask(__name__)

REPOS: dict[str, str] = {}

# Per-repo comment store: {repo_slug: {comment_id: comment_dict}}
comments: dict[str, dict[str, dict[str, Any]]] = {}


def parse_diff(diff_text: str) -> list[dict[str, Any]]:
    """Parse unified diff text into structured data."""
    if not diff_text.strip():
        return []

    files: list[dict[str, Any]] = []
    # Split on file boundaries
    chunks = re.split(r"^(diff --git .+)$", diff_text, flags=re.MULTILINE)

    i = 1  # skip empty first element
    while i < len(chunks):
        header = chunks[i]
        body = chunks[i + 1] if i + 1 < len(chunks) else ""
        i += 2

        # Extract filename
        match = re.search(r"diff --git a/(.+) b/(.+)", header)
        if not match:
            continue

        old_name = match.group(1)
        new_name = match.group(2)

        # Check for binary files
        if "Binary files" in body:
            files.append(
                {
                    "old_name": old_name,
                    "new_name": new_name,
                    "hunks": [],
                    "binary": True,
                }
            )
            continue

        # Extract file names from --- / +++ if present
        minus_match = re.search(r"^--- (?:a/)?(.+)$", body, re.MULTILINE)
        plus_match = re.search(r"^\+\+\+ (?:b/)?(.+)$", body, re.MULTILINE)
        if minus_match:
            old_name = minus_match.group(1)
        if plus_match:
            new_name = plus_match.group(1)

        # Parse hunks
        hunks = []
        hunk_splits = re.split(r"^(@@ .+? @@.*?)$", body, flags=re.MULTILINE)

        h = 1
        while h < len(hunk_splits):
            hunk_header = hunk_splits[h]
            hunk_body = hunk_splits[h + 1] if h + 1 < len(hunk_splits) else ""
            h += 2

            # Parse line numbers from @@ -old_start,old_count +new_start,new_count @@
            nums = re.search(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", hunk_header)
            if not nums:
                continue

            old_start = int(nums.group(1))
            new_start = int(nums.group(3))

            # Context text after @@
            context_text = hunk_header[nums.end() :].strip()

            lines = []
            old_line = old_start
            new_line = new_start

            for raw_line in hunk_body.split("\n"):
                if not raw_line and raw_line == "":
                    # Could be end of input
                    continue

                if raw_line.startswith("+"):
                    lines.append(
                        {
                            "type": "addition",
                            "content": raw_line[1:],
                            "old_line": None,
                            "new_line": new_line,
                        }
                    )
                    new_line += 1
                elif raw_line.startswith("-"):
                    lines.append(
                        {
                            "type": "deletion",
                            "content": raw_line[1:],
                            "old_line": old_line,
                            "new_line": None,
                        }
                    )
                    old_line += 1
                elif raw_line.startswith("\\"):
                    # "\ No newline at end of file"
                    lines.append(
                        {
                            "type": "no_newline",
                            "content": raw_line,
                            "old_line": None,
                            "new_line": None,
                        }
                    )
                else:
                    # Context line (starts with space or is empty)
                    content = raw_line[1:] if raw_line.startswith(" ") else raw_line
                    lines.append(
                        {
                            "type": "context",
                            "content": content,
                            "old_line": old_line,
                            "new_line": new_line,
                        }
                    )
                    old_line += 1
                    new_line += 1

            hunks.append(
                {
                    "header": hunk_header.strip(),
                    "context": context_text,
                    "old_start": old_start,
                    "new_start": new_start,
                    "lines": lines,
                }
            )

        files.append(
            {
                "old_name": old_name,
                "new_name": new_name,
                "hunks": hunks,
                "binary": False,
            }
        )

    return files


def get_diff(path: str) -> str:
    """Run git diff in the target repo."""
    try:
        result = subprocess.run(
            ["git", "diff", "HEAD"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        pass

    try:
        result = subprocess.run(
            ["git", "diff"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        return ""


def get_repo_path(repo: str) -> str:
    """Get repo path by slug, or abort 404."""
    path = REPOS.get(repo)
    if path is None:
        abort(404, description=f"Unknown repo: {repo}")
    return path


# --- Routes ---


@app.get("/")
def repos_index() -> str:
    return render_template("repos.html", repos=REPOS)


@app.get("/api/repos")
def api_repos() -> Response:
    return jsonify([{"slug": slug, "path": path} for slug, path in REPOS.items()])


@app.post("/api/repos")
def add_repo() -> tuple[Response, int] | Response:
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    slug = (data.get("slug") or "").strip()
    path = (data.get("path") or "").strip()

    if not slug or not SLUG_RE.match(slug):
        return jsonify({"error": "slug must be non-empty alphanumeric with hyphens"}), 400
    if not path or not os.path.isdir(path):
        return jsonify({"error": "path must be an existing directory"}), 400
    if slug in REPOS:
        return jsonify({"error": f"Repo '{slug}' already exists"}), 409

    REPOS[slug] = path
    return jsonify({"slug": slug, "path": path}), 201


@app.put("/api/repos/<slug>")
def update_repo(slug: str) -> tuple[Response, int] | Response:
    if slug not in REPOS:
        return jsonify({"error": f"Repo '{slug}' not found"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    path = (data.get("path") or "").strip()
    if not path or not os.path.isdir(path):
        return jsonify({"error": "path must be an existing directory"}), 400

    REPOS[slug] = path
    return jsonify({"slug": slug, "path": path})


@app.delete("/api/repos/<slug>")
def delete_repo(slug: str) -> tuple[Response, int] | tuple[str, int]:
    if slug not in REPOS:
        return jsonify({"error": f"Repo '{slug}' not found"}), 404

    del REPOS[slug]
    comments.pop(slug, None)
    return "", 204


@app.get("/<repo>/")
def index(repo: str) -> str:
    get_repo_path(repo)  # validate slug
    return render_template("index.html", repo_slug=repo)


@app.get("/<repo>/api/diff")
def api_diff(repo: str) -> Response:
    path = get_repo_path(repo)
    diff_text = get_diff(path)
    parsed = parse_diff(diff_text)
    return jsonify(parsed)


@app.get("/<repo>/api/comments")
def list_comments(repo: str) -> Response:
    get_repo_path(repo)  # validate slug
    repo_comments = comments.get(repo, {})
    file_filter = request.args.get("file")
    if file_filter:
        filtered = {k: v for k, v in repo_comments.items() if v["file"] == file_filter}
        return jsonify(list(filtered.values()))
    return jsonify(list(repo_comments.values()))


@app.delete("/<repo>/api/comments")
def clear_comments(repo: str) -> tuple[str, int]:
    get_repo_path(repo)  # validate slug
    comments.pop(repo, None)
    return "", 204


@app.post("/<repo>/api/comments")
def create_comment(repo: str) -> tuple[Response, int]:
    get_repo_path(repo)  # validate slug
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    required = ["file", "side", "start_line", "end_line", "body"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    comment_id = str(uuid.uuid4())
    comment = {
        "id": comment_id,
        "file": data["file"],
        "side": data["side"],
        "start_line": data["start_line"],
        "end_line": data["end_line"],
        "body": data["body"],
        "author": data.get("author", "anonymous"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    comments.setdefault(repo, {})[comment_id] = comment
    return jsonify(comment), 201


@app.get("/<repo>/api/comments/<comment_id>")
def get_comment(repo: str, comment_id: str) -> tuple[Response, int] | Response:
    get_repo_path(repo)  # validate slug
    comment = comments.get(repo, {}).get(comment_id)
    if not comment:
        return jsonify({"error": "Comment not found"}), 404
    return jsonify(comment)


@app.put("/<repo>/api/comments/<comment_id>")
def update_comment(repo: str, comment_id: str) -> tuple[Response, int] | Response:
    get_repo_path(repo)  # validate slug
    comment = comments.get(repo, {}).get(comment_id)
    if not comment:
        return jsonify({"error": "Comment not found"}), 404

    data = request.get_json()
    if not data or "body" not in data:
        return jsonify({"error": "Body field required"}), 400

    comment["body"] = data["body"]
    return jsonify(comment)


@app.delete("/<repo>/api/comments/<comment_id>")
def delete_comment(repo: str, comment_id: str) -> tuple[Response, int] | tuple[str, int]:
    get_repo_path(repo)  # validate slug
    repo_comments = comments.get(repo, {})
    if comment_id not in repo_comments:
        return jsonify({"error": "Comment not found"}), 404
    del repo_comments[comment_id]
    return "", 204


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def main() -> None:
    global REPOS
    if len(sys.argv) > 1:
        path = str(Path(sys.argv[1]).resolve())
        REPOS = {"default": path}
    else:
        REPOS = {}

    if REPOS:
        repo_list = ", ".join(f"{slug} -> {path}" for slug, path in REPOS.items())
        print(f"Differ: monitoring repos: {repo_list}")
    else:
        print("Differ: no repos configured — add repos via the web UI")
    print("Running on http://localhost:5001")
    app.run(host="127.0.0.1", port=5001, debug=True)


if __name__ == "__main__":
    main()
