import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const stagedFiles = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

if (stagedFiles.length === 0) {
  process.exit(0);
}

const lintableExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const formatableExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
]);

const lintableFiles = stagedFiles.filter((file) => lintableExtensions.has(path.extname(file)));
const formatableFiles = stagedFiles.filter((file) => formatableExtensions.has(path.extname(file)));
const docsOnly = stagedFiles.every((file) => file.endsWith(".md") || file.startsWith("docs/"));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (lintableFiles.length > 0) {
  run("npx", ["eslint", "--fix", ...lintableFiles]);
}

if (formatableFiles.length > 0) {
  run("npx", ["prettier", "--write", ...formatableFiles]);
}

run("git", ["add", ...stagedFiles]);

if (docsOnly) {
  console.log("Docs-only commit: skipped npm run check after formatting.");
  process.exit(0);
}

run("npm", ["run", "check"]);
