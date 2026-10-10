import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "knowledge-curator";
const ALLOWED_RUNTIME_MODULES = new Set(["obsidian"]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

async function readRequiredFile(directory, filename) {
  const filePath = path.join(directory, filename);
  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Required plugin file is missing: ${filePath}`);
    }
    throw error;
  }

  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Required plugin file is invalid: ${filePath}`);
  }

  return {
    contents: await readFile(filePath, "utf8"),
    filePath,
    size: fileStat.size
  };
}

function findRuntimeModules(bundle) {
  const modules = new Set();
  const requirePattern = /require\(["']([^"']+)["']\)/gu;
  let match = requirePattern.exec(bundle);

  while (match !== null) {
    modules.add(match[1]);
    match = requirePattern.exec(bundle);
  }

  return modules;
}

export async function hashFile(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

export async function verifyPluginDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  const manifestFile = await readRequiredFile(resolvedDirectory, "manifest.json");
  const bundleFile = await readRequiredFile(resolvedDirectory, "main.js");

  let manifest;
  try {
    manifest = JSON.parse(manifestFile.contents);
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error.message}`);
  }

  if (manifest.id !== PLUGIN_ID) {
    throw new Error(
      `manifest id must be "${PLUGIN_ID}", received "${String(manifest.id)}".`
    );
  }
  if (
    resolvedDirectory !== projectRoot &&
    path.basename(resolvedDirectory) !== PLUGIN_ID
  ) {
    throw new Error(
      `Deployed plugin directory must be named "${PLUGIN_ID}": ${resolvedDirectory}`
    );
  }
  if (typeof manifest.minAppVersion !== "string" || manifest.minAppVersion.length === 0) {
    throw new Error("manifest minAppVersion must be a non-empty string.");
  }
  if (manifest.isDesktopOnly !== true) {
    throw new Error("Phase 0 manifest must set isDesktopOnly to true.");
  }

  if (!bundleFile.contents.includes("module.exports")) {
    throw new Error("main.js is not a CommonJS Obsidian plugin bundle.");
  }

  const runtimeModules = findRuntimeModules(bundleFile.contents);
  const unsupportedModules = [...runtimeModules].filter(
    (moduleName) => !ALLOWED_RUNTIME_MODULES.has(moduleName)
  );
  if (unsupportedModules.length > 0) {
    throw new Error(
      `main.js contains unsupported runtime modules: ${unsupportedModules.join(", ")}`
    );
  }
  if (!runtimeModules.has("obsidian")) {
    throw new Error("main.js does not import the Obsidian API.");
  }

  return {
    directory: resolvedDirectory,
    id: manifest.id,
    minAppVersion: manifest.minAppVersion,
    isDesktopOnly: manifest.isDesktopOnly,
    mainBytes: bundleFile.size,
    mainSha256: await hashFile(bundleFile.filePath),
    runtimeModules: [...runtimeModules]
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const targetDirectory = process.argv[2]
    ? path.resolve(process.argv[2])
    : projectRoot;

  verifyPluginDirectory(targetDirectory)
    .then((result) => {
      console.log("Plugin bundle verification passed:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Plugin bundle verification failed: ${message}`);
      process.exitCode = 1;
    });
}
