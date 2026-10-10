import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
await loadLocalEnvironment();

const result = await build({
  entryPoints: ["scripts/vault-validation-runtime.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false
});
const code = result.outputFiles[0]?.text;
if (!code) throw new Error("Could not build Vault validation runtime.");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const configuredVault = argument("--vault") ?? process.env.TEST_VAULT?.trim();
if (!configuredVault) {
  throw new Error("TEST_VAULT is not configured. Set it in .env.local or pass --vault <path>.");
}
const vaultRoot = resolveConfiguredPath(configuredVault);
const outputRoot = path.join(projectRoot, "KnowledgeCuratorValidation");
const settings = await loadScope(vaultRoot);
const validation = await runtime.runVaultValidation(vaultRoot, settings);
const synthetic = await runtime.runSyntheticValidationBenchmark(1_000, 10_000);

await mkdir(path.join(outputRoot, "snapshot"), { recursive: true });
await mkdir(path.join(outputRoot, "reports"), { recursive: true });
await mkdir(path.join(outputRoot, "datasets"), { recursive: true });
await writeFile(
  path.join(outputRoot, "snapshot", "snapshot.json"),
  `${JSON.stringify(validation.snapshot, null, 2)}\n`,
  "utf8"
);
await writeFile(
  path.join(outputRoot, "reports", "baseline.json"),
  `${JSON.stringify({ ...validation.baseline, performance: validation.performance, safety: validation.safety }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  path.join(outputRoot, "reports", "vault-benchmark.json"),
  `${JSON.stringify({ version: validation.snapshot.version, generatedAt: new Date().toISOString(), realVault: validation.performance, synthetic }, null, 2)}\n`,
  "utf8"
);

console.log("Knowledge Curator Phase 7.5 Step 1 (local, read-only, no LLM/network)");
console.log(JSON.stringify({
  snapshot: {
    snapshotId: validation.snapshot.snapshotId,
    markdownCount: validation.snapshot.markdownCount,
    wikiCount: validation.snapshot.wikiCount,
    rawCount: validation.snapshot.rawCount,
    inboxCount: validation.snapshot.inboxCount
  },
  baseline: validation.baseline,
  performance: validation.performance,
  synthetic,
  safety: validation.safety,
  outputRoot
}, null, 2));

if (!validation.safety.unchanged) {
  throw new Error("Markdown changed while the read-only validation command was running.");
}
if (synthetic.snapshotMs >= 5_000 || synthetic.baselineMs >= 30_000) {
  throw new Error("Synthetic Snapshot/Baseline performance gate failed.");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveConfiguredPath(value) {
  const expanded = value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  return path.resolve(projectRoot, expanded);
}

async function loadScope(vaultRoot) {
  const settingsPath = path.join(vaultRoot, ".obsidian", "plugins", "knowledge-curator", "data.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  if (typeof settings.inboxFolder !== "string" || typeof settings.wikiFolder !== "string" || !Array.isArray(settings.rawFolders)) {
    throw new Error("Knowledge Curator folder settings are missing or invalid.");
  }
  return {
    inboxFolder: settings.inboxFolder,
    wikiFolder: settings.wikiFolder,
    rawFolders: settings.rawFolders.filter((value) => typeof value === "string")
  };
}

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
      if (!match) throw new Error(`Invalid .env.local line: ${rawLine}`);
      if (process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
