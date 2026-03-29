import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const packagesRoot = path.join(repoRoot, "packages");

const workspaceDirs = fs
  .readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const workspaceMeta = new Map();
const internalPackageNames = new Set();

for (const dir of workspaceDirs) {
  const packageJsonPath = path.join(packagesRoot, dir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  workspaceMeta.set(dir, {
    dir,
    packageRoot: path.join(packagesRoot, dir),
    packageName: packageJson.name,
    shortName: packageJson.name.split("/").pop(),
  });
  internalPackageNames.add(packageJson.name);
}

const trackedFiles = execFileSync("git", ["ls-files", "-z", "packages"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter((file) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(file))
  .filter((file) => !file.includes("/dist/"));

const specifierPatterns = [
  /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const violations = [];

function getPackageMetaForFile(file) {
  const normalized = file.split(path.sep).join("/");
  const match = normalized.match(/^packages\/([^/]+)\//);
  if (!match) {
    return undefined;
  }
  return workspaceMeta.get(match[1]);
}

function normalizeSpecifier(specifier) {
  return specifier.replace(/\\/g, "/");
}

function withinDirectory(targetPath, basePath) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

for (const file of trackedFiles) {
  const meta = getPackageMetaForFile(file);
  if (!meta) {
    continue;
  }

  const filePath = path.join(repoRoot, file);
  const source = fs.readFileSync(filePath, "utf8");
  const seen = [];

  for (const pattern of specifierPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        seen.push(specifier);
      }
    }
  }

  for (const rawSpecifier of seen) {
    const specifier = normalizeSpecifier(rawSpecifier);

    if (specifier.startsWith("@serverless-openclaw/")) {
      const [, shortName, subpath] =
        specifier.match(/^@serverless-openclaw\/([^/]+)(\/.*)?$/) ?? [];
      if (!shortName) {
        continue;
      }

      if (subpath) {
        violations.push(`${file}: internal package subpath import is forbidden (${specifier})`);
        continue;
      }

      if (!internalPackageNames.has(specifier)) {
        continue;
      }

      if (meta.shortName === "shared" && shortName !== "shared") {
        violations.push(`${file}: shared package cannot depend on ${specifier}`);
        continue;
      }

      if (meta.shortName !== shortName && shortName !== "shared") {
        violations.push(
          `${file}: ${meta.packageName} may only depend on shared across workspace boundaries (${specifier})`,
        );
      }
      continue;
    }

    if (specifier.startsWith("packages/") || specifier.includes("/packages/")) {
      violations.push(`${file}: direct workspace path import is forbidden (${specifier})`);
      continue;
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      continue;
    }

    const resolvedPath = specifier.startsWith("/")
      ? path.resolve(repoRoot, `.${specifier}`)
      : path.resolve(path.dirname(filePath), specifier);

    if (!withinDirectory(resolvedPath, meta.packageRoot)) {
      violations.push(`${file}: relative import escapes package root (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations detected:");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log("Architecture boundaries verified.");
