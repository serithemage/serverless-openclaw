import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".md",
  ".json",
  ".yml",
  ".yaml",
]);

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function splitNullSeparated(output) {
  return output.split("\0").filter(Boolean);
}

function includeFile(file) {
  const extension = path.extname(file);
  if (!supportedExtensions.has(extension)) {
    return false;
  }

  return (
    file.startsWith(".agents/") ||
    file.startsWith(".claude/") ||
    file.startsWith(".codex/") ||
    file.startsWith("packages/") ||
    file.startsWith("scripts/") ||
    file.startsWith("docs/") ||
    file.startsWith(".github/") ||
    file === "AGENTS.md" ||
    file === "README.md" ||
    file === "CLAUDE.md" ||
    file === "RELEASE_NOTES.md" ||
    file === "package.json"
  );
}

function changedFilesFromBase(baseSha) {
  if (!baseSha || baseSha === "0000000000000000000000000000000000000000") {
    return [];
  }

  try {
    return git(["diff", "--name-only", "--diff-filter=ACMR", `${baseSha}...HEAD`])
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const baseSha = process.env.GATEKEEPING_BASE_SHA;
const changedFiles = new Set();

if (baseSha) {
  for (const file of changedFilesFromBase(baseSha)) {
    changedFiles.add(file);
  }
}

for (const file of splitNullSeparated(git(["diff", "--name-only", "--diff-filter=ACMR", "-z"]))) {
  changedFiles.add(file);
}

for (const file of splitNullSeparated(
  git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]),
)) {
  changedFiles.add(file);
}

for (const file of splitNullSeparated(git(["ls-files", "--others", "--exclude-standard", "-z"]))) {
  changedFiles.add(file);
}

const filesToCheck = [...changedFiles].filter(includeFile).sort();

if (filesToCheck.length === 0) {
  console.log("No changed files require formatting checks.");
  process.exit(0);
}

const result = spawnSync("npx", ["prettier", "--check", ...filesToCheck], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
