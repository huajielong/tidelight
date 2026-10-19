import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const buildEntries = ["index.html", "styles.css", "src", "assets"];

if (path.dirname(outputDirectory) !== projectRoot || path.basename(outputDirectory) !== "dist") {
  throw new Error("Build output must be the dist directory inside the project.");
}
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of buildEntries) {
  const source = path.join(projectRoot, entry);
  const destination = path.join(outputDirectory, entry);

  try {
    const sourceStats = await stat(source);
    await cp(source, destination, { recursive: sourceStats.isDirectory() });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Required build input is missing: ${entry}`, { cause: error });
    }
    throw error;
  }
}

console.log(`Built ${buildEntries.length} entries into ${path.relative(projectRoot, outputDirectory)}.`);
