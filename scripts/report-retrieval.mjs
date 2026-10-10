import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const vaultPath = process.env.TEST_VAULT?.trim();
if (!vaultPath) {
  throw new Error("TEST_VAULT is required.");
}

const pluginDataPath = path.join(
  vaultPath,
  ".obsidian",
  "plugins",
  "knowledge-curator",
  "data.json"
);
const pluginData = JSON.parse(await readFile(pluginDataPath, "utf8"));
const rawFolders = Array.isArray(pluginData.rawFolders)
  ? pluginData.rawFolders
  : typeof pluginData.rawFolder === "string"
    ? [pluginData.rawFolder]
    : [];
const maximum = typeof pluginData.maxRelatedNotes === "number"
  ? pluginData.maxRelatedNotes
  : 8;
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "knowledge-curator-retrieval-"));
const bundlePath = path.join(temporaryDirectory, "retrieval.mjs");

try {
  await build({
    entryPoints: ["src/services/retrieval-service.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: bundlePath
  });
  const { buildRetrievalSignals, scoreKnowledgeCandidate } = await import(
    `${pathToFileURL(bundlePath).href}?time=${Date.now()}`
  );
  const sources = await readMarkdownDirectory(path.join(vaultPath, pluginData.inboxFolder));
  const knowledgeFiles = [
    ...(await readMarkdownDirectory(path.join(vaultPath, pluginData.wikiFolder))).map(
      (file) => ({ ...file, kind: "wiki" })
    ),
    ...(await Promise.all(rawFolders.map(async (folder) =>
      (await readMarkdownDirectory(path.join(vaultPath, folder))).map(
        (file) => ({ ...file, kind: "raw" })
      )
    ))).flat()
  ];

  const report = [];
  for (const source of sources) {
    const sourceMetadata = parseFrontmatter(source.content, source.basename);
    const sourceSignals = buildRetrievalSignals(
      sourceMetadata.title,
      source.content,
      { tags: sourceMetadata.tags }
    );
    const candidates = knowledgeFiles.map((candidate) => {
      const metadata = parseFrontmatter(candidate.content, candidate.basename);
      const score = scoreKnowledgeCandidate(
        sourceSignals,
        buildRetrievalSignals(metadata.title, candidate.content, { tags: metadata.tags }),
        candidate.kind
      );
      return {
        path: candidate.relativePath,
        title: metadata.title,
        kind: candidate.kind,
        relevance: score.relevance,
        reason: score.reason
      };
    }).sort((left, right) =>
      right.relevance - left.relevance ||
      (left.kind === right.kind ? left.path.localeCompare(right.path) : left.kind === "wiki" ? -1 : 1)
    ).slice(0, maximum);
    report.push({ source: sourceMetadata.title, candidates });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function readMarkdownDirectory(directoryPath) {
  const files = [];
  await walk(directoryPath, files);
  return files;
}

async function walk(directoryPath, output) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath, output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      output.push({
        basename: entry.name.slice(0, -3),
        relativePath: path.relative(vaultPath, absolutePath),
        content: await readFile(absolutePath, "utf8")
      });
    }
  }
}

function parseFrontmatter(content, fallbackTitle) {
  if (!content.startsWith("---")) {
    return { title: fallbackTitle, tags: [] };
  }
  const closing = content.indexOf("\n---", 3);
  if (closing < 0) {
    return { title: fallbackTitle, tags: [] };
  }
  const frontmatter = content.slice(3, closing);
  const titleMatch = /^title:\s*["']?(.*?)["']?\s*$/imu.exec(frontmatter);
  const tagsMatch = /^tags:\s*\[([^\]]*)\]\s*$/imu.exec(frontmatter);
  const blockTags = [];
  const lines = frontmatter.split(/\r?\n/u);
  const tagsIndex = lines.findIndex((line) => /^tags:\s*$/iu.test(line));
  if (tagsIndex >= 0) {
    for (let index = tagsIndex + 1; index < lines.length; index += 1) {
      const match = /^\s+-\s+["']?(.*?)["']?\s*$/u.exec(lines[index]);
      if (match?.[1] === undefined) {
        break;
      }
      blockTags.push(match[1].trim());
    }
  }
  return {
    title: titleMatch?.[1]?.trim() || fallbackTitle,
    tags: tagsMatch?.[1]
      ?.split(",")
      .map((tag) => tag.trim().replace(/^['"]|['"]$/gu, ""))
      .filter(Boolean) ?? blockTags
  };
}
