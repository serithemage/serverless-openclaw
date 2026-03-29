import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const offenders = [];

for (const file of tracked) {
  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    continue;
  }

  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) {
    continue;
  }

  const lines = buffer.toString("utf8").split(/\r?\n/);
  const hasConflictFence =
    lines.some((line) => line.startsWith("<<<<<<< ")) ||
    lines.some((line) => line.startsWith(">>>>>>> "));

  if (!hasConflictFence) {
    continue;
  }

  lines.forEach((line, index) => {
    if (/^(<<<<<<< |=======|>>>>>>> )/.test(line)) {
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Merge conflict markers detected:");
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  process.exit(1);
}

console.log("No merge conflict markers found.");
