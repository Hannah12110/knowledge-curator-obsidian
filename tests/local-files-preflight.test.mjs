import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(projectRoot, "scripts/check-local-files.sh");

test("local-file preflight passes with fully local files", async () => {
  const fixture = await projectFixture("plain");
  const result = run(fixture.root, fixture.list);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS/u);
});

test("local-file preflight fails fast for critical dataless files", async () => {
  const fixture = await projectFixture("critical");
  await writeFile(fixture.list, `${path.join(fixture.root, "scripts/review-claim-graph.mjs")}\n`);
  const result = run(fixture.root, fixture.list);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Critical files must be fully downloaded/u);
  assert.match(result.stdout, /scripts\/review-claim-graph\.mjs/u);
});

test("local-file preflight reports actionable node_modules recovery", async () => {
  const fixture = await projectFixture("node-modules");
  await writeFile(fixture.list, `${path.join(fixture.root, "node_modules/esbuild/bin/esbuild")}\n`);
  const result = run(fixture.root, fixture.list);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /node_modules contains iCloud placeholder files/u);
  assert.match(result.stdout, /rm -rf node_modules[\s\S]*npm ci/u);
});

test("local-file preflight skips gracefully outside Darwin", () => {
  const result = spawnSync("bash", [checker], {
    encoding: "utf8",
    env: { ...process.env, KC_PREFLIGHT_PLATFORM: "Linux", KC_PREFLIGHT_PROJECT_ROOT: "/missing/project" }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped on Linux[\s\S]*PASS/u);
});

test("local-file preflight supports project paths containing spaces", async () => {
  const fixture = await projectFixture("project with spaces");
  assert.equal(run(fixture.root, fixture.list).status, 0);
});

test("local-file preflight accepts empty required directories", async () => {
  const fixture = await projectFixture("empty-dirs", false);
  assert.equal(run(fixture.root, fixture.list).status, 0);
});

test("local-file preflight reports missing required directories", async () => {
  const fixture = await projectFixture("missing-dir");
  await rm(path.join(fixture.root, "tests"), { recursive: true });
  const result = run(fixture.root, fixture.list);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Required project files or directories are missing[\s\S]*tests/u);
});

test("local-file preflight supports command-specific repository inputs", async () => {
  const fixture = await projectFixture("extra-input");
  await mkdir(path.join(fixture.root, "KnowledgeCuratorRegression"));
  const placeholder = path.join(fixture.root, "KnowledgeCuratorRegression", "case.json");
  await writeFile(placeholder, "{}\n");
  await writeFile(fixture.list, `${placeholder}\n`);

  const result = run(fixture.root, fixture.list, {
    KC_PREFLIGHT_EXTRA_PATHS: "KnowledgeCuratorRegression"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /KnowledgeCuratorRegression\/case\.json/u);
});

async function projectFixture(name, addSourceFiles = true) {
  const parent = await mkdtemp(path.join(tmpdir(), "kc-preflight-"));
  const root = path.join(parent, name);
  await Promise.all(["src", "scripts", "tests", "node_modules"].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await Promise.all(["package.json", "package-lock.json", "tsconfig.json", "esbuild.config.mjs"].map((file) => writeFile(path.join(root, file), "{}\n")));
  if (addSourceFiles) await writeFile(path.join(root, "scripts", "review-claim-graph.mjs"), "// fixture\n");
  const list = path.join(parent, "dataless.txt");
  await writeFile(list, "");
  return { root, list };
}

function run(root, fixtureFile, extraEnv = {}) {
  return spawnSync("bash", [checker], {
    encoding: "utf8",
    env: {
      ...process.env,
      KC_PREFLIGHT_PLATFORM: "Darwin",
      KC_PREFLIGHT_PROJECT_ROOT: root,
      KC_PREFLIGHT_FIXTURE_FILE: fixtureFile,
      ...extraEnv
    }
  });
}
