import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  { directory: "src", extension: ".js" },
  { directory: "scripts", extension: ".mjs" },
  { directory: "netlify/functions", extension: ".mjs" },
];

const files = [];

for (const check of checks) {
  const directory = path.join(projectRoot, check.directory);

  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && path.extname(entry.name) === check.extension) {
        files.push(path.join(directory, entry.name));
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

files.sort((left, right) => left.localeCompare(right));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(`Syntax check passed for ${files.length} file${files.length === 1 ? "" : "s"}.`);
}
