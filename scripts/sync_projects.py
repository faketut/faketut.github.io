"""
Fetches all public, non-fork repos for GITHUB_USER that have a description,
sorts them by stars (desc) then last-pushed (desc), and rewrites the
## Projects section in source/about/index.md.

Top TOP_COUNT repos go in the main list; the rest go in a <details> block.
"""

import json
import os
import re
import urllib.request

GITHUB_USER = "faketut"
ABOUT_FILE  = "source/about/index.md"
TOP_COUNT   = 6
SKIP_REPOS  = {f"{GITHUB_USER}.github.io"}   # repos to always exclude


def fetch_all_repos(token: str) -> list[dict]:
    repos, page = [], 1
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    while True:
        url = (
            f"https://api.github.com/users/{GITHUB_USER}/repos"
            f"?type=public&per_page=100&page={page}"
        )
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            batch = json.loads(resp.read())
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def build_projects_section(repos: list[dict]) -> str:
    filtered = [
        r for r in repos
        if not r["fork"]
        and r["name"] not in SKIP_REPOS
        and r.get("description")
    ]
    filtered.sort(key=lambda r: (r["stargazers_count"], r["pushed_at"]), reverse=True)

    def line(r: dict) -> str:
        desc = r["description"].rstrip(".")
        return f"- [**{r['name']}**]({r['html_url']}): {desc}."

    top  = filtered[:TOP_COUNT]
    rest = filtered[TOP_COUNT:]

    parts = [line(r) for r in top]

    if rest:
        parts += [
            "",
            "<details>",
            "<summary>More projects</summary>",
            "",
            *[line(r) for r in rest],
            "",
            "</details>",
        ]

    return "\n".join(parts)


def update_about(projects_section: str) -> None:
    with open(ABOUT_FILE, "r") as f:
        content = f.read()

    start_marker = "## Projects\n\n"
    if start_marker not in content:
        raise ValueError(f"Marker {start_marker!r} not found in {ABOUT_FILE}. "
                         f"File starts with: {content[:200]!r}")

    start = content.index(start_marker) + len(start_marker)

    # Find the next H2 after the projects block
    next_h2 = re.search(r"\n\n## ", content[start:])
    if not next_h2:
        raise ValueError("Could not find a section after ## Projects")
    end = start + next_h2.start()

    new_content = content[:start] + projects_section + content[end:]
    if new_content == content:
        print("Projects section is already up to date.")
        return

    with open(ABOUT_FILE, "w") as f:
        f.write(new_content)
    print("Projects section updated.")


if __name__ == "__main__":
    token = os.environ.get("GH_TOKEN", "")
    repos = fetch_all_repos(token)
    section = build_projects_section(repos)
    update_about(section)
