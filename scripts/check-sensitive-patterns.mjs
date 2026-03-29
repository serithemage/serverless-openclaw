import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.startsWith("references/"))
  .filter((file) => !file.startsWith("node_modules/"))
  .filter((file) => !file.startsWith("cdk.out/"));

const detectors = [
  { name: "AWS access key", regex: /\bA(?:KI|SI)A[0-9A-Z]{16}\b/g },
  { name: "GitHub token", regex: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/g },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
];

const findings = [];

for (const file of tracked) {
  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    continue;
  }

  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) {
    continue;
  }

  const source = buffer.toString("utf8");
  const lines = source.split(/\r?\n/);

  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    for (const match of source.matchAll(detector.regex)) {
      const index = match.index ?? 0;
      const lineNumber = source.slice(0, index).split(/\r?\n/).length;
      const excerpt = lines[lineNumber - 1]?.trim() ?? detector.name;
      findings.push(`${file}:${lineNumber}: ${detector.name}: ${excerpt}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets detected:");
  for (const finding of findings) {
    console.error(`  ${finding}`);
  }
  process.exit(1);
}

console.log("No obvious secrets detected in tracked files.");
