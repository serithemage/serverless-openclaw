import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = path.join(repoRoot, ".agents", "skills");
const targetRoots = [
  path.join(repoRoot, ".claude", "skills"),
  path.join(repoRoot, ".codex", "skills"),
];
const checkMode = process.argv.includes("--check");

function listEntries(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs.readdirSync(root).sort();
}

function listFilesRecursive(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];

  function walk(currentRoot, relativeRoot = "") {
    const entries = fs
      .readdirSync(currentRoot, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryRelativePath = path.join(relativeRoot, entry.name);
      const absolutePath = path.join(currentRoot, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, entryRelativePath);
      } else if (entry.isFile()) {
        files.push(entryRelativePath);
      }
    }
  }

  walk(root);
  return files;
}

function syncTarget(targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });

  const sourceEntries = listEntries(sourceRoot);
  const targetEntries = listEntries(targetRoot);

  for (const entry of targetEntries) {
    if (!sourceEntries.includes(entry)) {
      fs.rmSync(path.join(targetRoot, entry), { recursive: true, force: true });
    }
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceRoot, entry);
    const targetPath = path.join(targetRoot, entry);
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function compareTarget(targetRoot) {
  const drifts = [];
  const sourceEntries = listEntries(sourceRoot);
  const targetEntries = listEntries(targetRoot);

  for (const entry of sourceEntries) {
    if (!targetEntries.includes(entry)) {
      drifts.push(`${path.relative(repoRoot, targetRoot)} missing ${entry}`);
      continue;
    }

    const sourceEntryRoot = path.join(sourceRoot, entry);
    const targetEntryRoot = path.join(targetRoot, entry);
    const sourceFiles = listFilesRecursive(sourceEntryRoot);
    const targetFiles = listFilesRecursive(targetEntryRoot);

    for (const file of sourceFiles) {
      if (!targetFiles.includes(file)) {
        drifts.push(`${path.relative(repoRoot, targetRoot)}/${entry} missing ${file}`);
        continue;
      }

      const sourceContent = fs.readFileSync(path.join(sourceEntryRoot, file), "utf8");
      const targetContent = fs.readFileSync(path.join(targetEntryRoot, file), "utf8");
      if (sourceContent !== targetContent) {
        drifts.push(
          `${path.relative(repoRoot, targetRoot)}/${entry}/${file} differs from canonical source`,
        );
      }
    }

    for (const file of targetFiles) {
      if (!sourceFiles.includes(file)) {
        drifts.push(`${path.relative(repoRoot, targetRoot)}/${entry} has extra file ${file}`);
      }
    }
  }

  for (const entry of targetEntries) {
    if (!sourceEntries.includes(entry)) {
      drifts.push(`${path.relative(repoRoot, targetRoot)} has stale entry ${entry}`);
    }
  }

  return drifts;
}

if (!fs.existsSync(sourceRoot)) {
  console.error("Canonical skill source is missing: .agents/skills");
  process.exit(1);
}

if (checkMode) {
  const drifts = targetRoots.flatMap(compareTarget);
  if (drifts.length > 0) {
    console.error("Agent skill mirrors are out of sync:");
    for (const drift of drifts) {
      console.error(`  ${drift}`);
    }
    process.exit(1);
  }

  console.log("Agent skill mirrors are in sync.");
  process.exit(0);
}

for (const targetRoot of targetRoots) {
  syncTarget(targetRoot);
}

console.log("Synced agent skills to Claude and Codex mirrors.");
