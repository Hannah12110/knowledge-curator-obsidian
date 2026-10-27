import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { mkdir, readFile, writeFile, access, readdir } from "node:fs/promises";
const option = process.argv.indexOf("--root");
const root = option >= 0 ? resolve(process.argv[option + 1] ?? ".") : process.cwd();
const compiled = await build({ entryPoints: ["src/services/performance-repository.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { PerformanceRepository } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
let wikiFolder = "wiki";
try { const settings = JSON.parse(await readFile(resolve(root, ".obsidian/plugins/knowledge-curator/data.json"), "utf8")); if (typeof settings.wikiFolder === "string") wikiFolder = settings.wikiFolder; } catch { /* Source checkouts need not have vault settings. */ }
const repository = new PerformanceRepository({
  exists: async (path) => { try { await access(resolve(root, path)); return true; } catch { return false; } },
  mkdir: (path) => mkdir(resolve(root, path), { recursive: true }),
  write: async (path, content) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), content); },
  read: (path) => readFile(resolve(root, path), "utf8"),
  list: async (path) => { const entries = await readdir(resolve(root, path), { withFileTypes: true }); return { files: entries.filter((entry) => entry.isFile()).map((entry) => `${path}/${entry.name}`), folders: [] }; }
}, () => wikiFolder);
await repository.report();
const real = (await repository.records()).filter((record) => record.sampleKind === "real");
console.log(`Local performance report generated; real samples: ${real.length}. No network requests made.`);
console.log(resolve(root, "KnowledgeCuratorValidation/reports/claim-comparison-performance.json"));
console.log(resolve(root, "KnowledgeCuratorValidation/reports/claim-comparison-performance.md"));
