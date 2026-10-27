import { build } from "esbuild";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = await mkdtemp(join(tmpdir(), "knowledge-curator-tests-"));

try {
  const localFilesResult = spawnSync(process.execPath, ["--test", "tests/local-files-preflight.test.mjs"], {
    stdio: "inherit"
  });
  if (localFilesResult.status !== 0) {
    process.exitCode = localFilesResult.status ?? 1;
    process.exit();
  }
  await build({
    entryPoints: [
      "tests/batch-analysis.test.ts",
      "tests/batch-view.test.ts",
      "tests/global-workspace.test.ts",
      "tests/performance-metrics.test.ts",
      "tests/one-click-workflow.test.ts",
      "tests/one-click-services-integration.test.ts",
      "tests/workflow-view.test.ts",
      "tests/workflow-controller.test.ts",
      "tests/v013-product-compatibility.test.ts",
      "tests/workflow-presenter.test.ts",
      "tests/source-analysis-validator.test.ts",
      "tests/analysis-cache-service.test.ts",
      "tests/retrieval-scoring.test.ts",
      "tests/llm-service.test.ts",
      "tests/settings-migration.test.ts",
      "tests/sidebar-restore-state.test.ts",
      "tests/path-scope.test.ts",
      "tests/retrieval-scope.test.ts",
      "tests/write-scope-guard.test.ts",
      "tests/knowledge-pr-validator.test.ts",
      "tests/knowledge-pr-cache-service.test.ts",
      "tests/knowledge-write-service.test.ts",
      "tests/search-provider.test.ts",
      "tests/source-ranking.test.ts",
      "tests/verification-validator.test.ts",
      "tests/conflict-verification-service.test.ts",
      "tests/workflow-state.test.ts",
      "tests/cache-maintenance.test.ts",
      "tests/error-model.test.ts",
      "tests/claim-identity-retrieval.test.ts",
      "tests/claim-retrieval-performance.test.ts",
      "tests/claim-validator-store.test.ts",
      "tests/claim-comparison-aggregator.test.ts",
      "tests/claim-comparison-fast-path.test.ts",
      "tests/comparison-cache-service.test.ts",
      "tests/comparison-execution.test.ts",
      "tests/claim-store-service.test.ts",
      "tests/analysis-service-claim-mode.test.ts",
      "tests/freshness-risk-service.test.ts",
      "tests/freshness-verification-validator.test.ts",
      "tests/freshness-verification-service.test.ts",
      "tests/maintenance-service.test.ts",
      "tests/maintenance-pr-validator.test.ts"
      ,"tests/claim-graph-validator.test.ts"
      ,"tests/claim-graph-candidate.test.ts"
      ,"tests/claim-graph-relation-compression.test.ts"
      ,"tests/claim-graph-repository.test.ts"
      ,"tests/vault-validation-service.test.ts"
      ,"tests/real-claim-graph-build.test.ts"
      ,"tests/claim-graph-evaluation.test.ts"
      ,"tests/claim-graph-calibration.test.ts"
      ,"tests/claim-graph-model-choice.test.ts"
      ,"tests/claim-graph-release-boundary.test.ts"
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outdir: outputDirectory,
    plugins: [{
      name: "obsidian-test-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^obsidian$/u }, () => ({
          path: "obsidian",
          namespace: "obsidian-test-stub"
        }));
        buildApi.onLoad({ filter: /.*/u, namespace: "obsidian-test-stub" }, () => ({
          contents: `export * from ${JSON.stringify(join(process.cwd(), "tests/obsidian-ui-stub.ts"))};`,
          resolveDir: process.cwd(),
          loader: "js"
        }));
      }
    }]
  });

  const testFiles = (await readdir(outputDirectory))
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => join(outputDirectory, file));
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
