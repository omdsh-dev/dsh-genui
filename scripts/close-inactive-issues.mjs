#!/usr/bin/env node

const INACTIVE_DAYS = 14;
const PAGE_SIZE = 100;
const EXEMPT_AUTHOR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

if (!token || !repository) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY environment variables are required.");
  process.exit(1);
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(path, options = {}) {
  const response = await fetch(apiUrl + "/repos/" + repository + path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      "GitHub API request failed (" +
        response.status +
        " " +
        response.statusText +
        ") for " +
        path +
        ": " +
        responseText.slice(0, 1000),
    );
  }

  return responseText ? JSON.parse(responseText) : null;
}

function isExempt(issue) {
  const login = issue.user?.login?.toLowerCase() || "";
  const association = String(issue.author_association || "").toUpperCase();

  return (
    login.endsWith("[bot]") ||
    EXEMPT_AUTHOR_ASSOCIATIONS.has(association)
  );
}

async function listInactiveIssues(cutoff) {
  const inactiveIssues = [];

  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      state: "open",
      sort: "updated",
      direction: "asc",
      per_page: String(PAGE_SIZE),
      page: String(page),
    });
    const issues = await github("/issues?" + params.toString());

    if (!Array.isArray(issues)) {
      throw new Error("GitHub returned an invalid issue list.");
    }

    console.log("Fetched page " + page + ": " + issues.length + " open issues and pull requests.");

    let foundRecentActivity = false;

    for (const issue of issues) {
      const updatedAt = Date.parse(issue.updated_at);
      if (!Number.isFinite(updatedAt)) {
        throw new Error("Issue #" + issue.number + " has an invalid updated_at value.");
      }

      // Results are ordered by updated_at ascending, so later pages are also recent.
      if (updatedAt >= cutoff) {
        foundRecentActivity = true;
        break;
      }

      // The issues endpoint also returns pull requests.
      if (issue.pull_request) continue;

      if (isExempt(issue)) {
        console.log(
          "Skipping inactive issue #" +
            issue.number +
            "; author " +
            (issue.user?.login || "unknown") +
            " is exempt.",
        );
        continue;
      }

      inactiveIssues.push(issue);
    }

    if (foundRecentActivity || issues.length < PAGE_SIZE) break;
  }

  return inactiveIssues;
}

async function closeIssue(issue, cutoff) {
  // Recheck the issue immediately before acting in case it received new activity
  // after the paginated list was fetched.
  const current = await github("/issues/" + issue.number);

  if (!current || current.state !== "open" || current.pull_request) {
    console.log("Skipping issue #" + issue.number + "; it is no longer an open issue.");
    return false;
  }

  const updatedAt = Date.parse(current.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt >= cutoff) {
    console.log("Skipping issue #" + issue.number + "; it has recent activity.");
    return false;
  }

  if (isExempt(current)) {
    console.log("Skipping issue #" + issue.number + "; its author is exempt.");
    return false;
  }

  const message =
    "此 Issue 已连续 " +
    INACTIVE_DAYS +
    " 天没有活动，现由 github-actions[bot] 自动关闭。\n\n" +
    "如果问题仍然存在，欢迎补充最新信息后重新打开。";

  await github("/issues/" + issue.number + "/comments", {
    method: "POST",
    body: JSON.stringify({ body: message }),
  });

  await github("/issues/" + issue.number, {
    method: "PATCH",
    body: JSON.stringify({
      state: "closed",
      state_reason: "not_planned",
    }),
  });

  console.log("Closed https://github.com/" + repository + "/issues/" + issue.number);
  return true;
}

async function main() {
  const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const inactiveIssues = await listInactiveIssues(cutoff);

  console.log("Found " + inactiveIssues.length + " inactive issues to review.");

  let closed = 0;
  for (const issue of inactiveIssues) {
    if (await closeIssue(issue, cutoff)) closed++;
  }

  console.log("Closed " + closed + " inactive issues.");
}

main().catch((error) => {
  console.error("Failed to close inactive issues:", error);
  process.exitCode = 1;
});
