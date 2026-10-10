import { copyFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, verifyPluginDirectory } from "./verify-plugin.mjs";

const PLUGIN_ID = "knowledge-curator";
const REQUIRED_ARTIFACTS = ["main.js", "manifest.json"];
const OPTIONAL_ARTIFACTS = ["styles.css"];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

function parseLocalEnvironment(contents) {
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (match === null) {
      throw new Error(`Invalid .env.local line: ${rawLine}`);
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = rawValue.trim();
    const hasMatchingQuotes =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (hasMatchingQuotes && value.length >= 2) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function loadLocalEnvironment() {
  const localEnvironmentPath = path.join(projectRoot, ".env.local");

  try {
    const contents = await readFile(localEnvironmentPath, "utf8");
    parseLocalEnvironment(contents);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function resolveVaultPath(configuredPath) {
  const expandedPath = configuredPath.startsWith("~/")
    ? path.join(homedir(), configuredPath.slice(2))
    : configuredPath;

  return path.resolve(projectRoot, expandedPath);
}

async function assertDirectory(directoryPath, label) {
  let directoryStat;
  try {
    directoryStat = await stat(directoryPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${directoryPath}`);
    }
    throw error;
  }

  if (!directoryStat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
}

async function getArtifacts() {
  const artifacts = [];

  for (const filename of REQUIRED_ARTIFACTS) {
    const sourcePath = path.join(projectRoot, filename);
    let artifactStat;
    try {
      artifactStat = await stat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Required build artifact is missing: ${filename}`);
      }
      throw error;
    }

    if (!artifactStat.isFile() || artifactStat.size === 0) {
      throw new Error(`Required build artifact is invalid: ${filename}`);
    }
    artifacts.push({ filename, sourcePath });
  }

  for (const filename of OPTIONAL_ARTIFACTS) {
    const sourcePath = path.join(projectRoot, filename);
    try {
      const artifactStat = await stat(sourcePath);
      if (artifactStat.isFile() && artifactStat.size > 0) {
        artifacts.push({ filename, sourcePath });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return artifacts;
}

async function copyArtifact({ filename, sourcePath }, targetDirectory) {
  const targetPath = path.join(targetDirectory, filename);
  const temporaryPath = `${targetPath}.tmp`;
  const sourceHash = await hashFile(sourcePath);

  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  const targetHash = await hashFile(targetPath);
  if (sourceHash !== targetHash) {
    throw new Error(`Checksum mismatch after copying ${filename}.`);
  }

  return sourceHash;
}

async function deploy() {
  await loadLocalEnvironment();

  const configuredVaultPath = process.env.TEST_VAULT?.trim();
  if (!configuredVaultPath) {
    throw new Error(
      "TEST_VAULT is not configured. Set it in the environment or copy .env.local.example to .env.local."
    );
  }

  const vaultPath = resolveVaultPath(configuredVaultPath);
  const obsidianDirectory = path.join(vaultPath, ".obsidian");
  const targetDirectory = path.join(
    obsidianDirectory,
    "plugins",
    PLUGIN_ID
  );

  await assertDirectory(vaultPath, "Test Vault");
  await assertDirectory(obsidianDirectory, "Obsidian configuration directory");

  const sourceVerification = await verifyPluginDirectory(projectRoot);
  const artifacts = await getArtifacts();
  await mkdir(targetDirectory, { recursive: true });

  const copiedArtifacts = [];
  for (const artifact of artifacts) {
    const sha256 = await copyArtifact(artifact, targetDirectory);
    copiedArtifacts.push({ ...artifact, sha256 });
  }

  const deployedVerification = await verifyPluginDirectory(targetDirectory);

  console.log(`Deployed ${artifacts.length} files to:`);
  console.log(targetDirectory);
  for (const artifact of copiedArtifacts) {
    console.log(`- ${artifact.filename} (${artifact.sha256})`);
  }
  console.log(`Source main.js:   ${sourceVerification.mainSha256}`);
  console.log(`Deployed main.js: ${deployedVerification.mainSha256}`);
  console.log("Existing plugin data.json was preserved.");
}

deploy().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Deploy failed: ${message}`);
  process.exitCode = 1;
});
