import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWritableWikiPath,
  isInsideWritableWikiScope,
  sanitizeWikiFilename
} from "../src/services/write-scope-guard";

test("allows only Markdown files below the fixed Phase 3 test wiki root", () => {
  assert.equal(
    isInsideWritableWikiScope("KnowledgeCuratorPhase1Test/wiki/Agent Memory.md"),
    true
  );
  assert.equal(isInsideWritableWikiScope("KnowledgeCuratorPhase1Test/wiki"), false);
  assert.equal(isInsideWritableWikiScope("KnowledgeCuratorPhase1Test/wiki/file.pdf"), false);
});

test("rejects traversal, absolute paths, URLs, and Windows drive paths", () => {
  const unsafePaths = [
    "KnowledgeCuratorPhase1Test/wiki/../../03_公众号阅读/wiki/Test.md",
    "KnowledgeCuratorPhase1Test/wiki\\..\\03_公众号阅读\\wiki\\Test.md",
    "/KnowledgeCuratorPhase1Test/wiki/Test.md",
    "C:\\MyWiki\\KnowledgeCuratorPhase1Test\\wiki\\Test.md",
    "file:///KnowledgeCuratorPhase1Test/wiki/Test.md"
  ];
  for (const path of unsafePaths) {
    assert.equal(isInsideWritableWikiScope(path), false, path);
  }
});

test("rejects same-prefix and real MyWiki directories", () => {
  assert.equal(
    isInsideWritableWikiScope("KnowledgeCuratorPhase1Test/wiki-old/Test.md"),
    false
  );
  assert.equal(isInsideWritableWikiScope("03_公众号阅读/wiki/Test.md"), false);
  assert.equal(isInsideWritableWikiScope("wiki/Test.md"), false);
});

test("builds a sanitized path inside the fixed writable root", () => {
  assert.equal(sanitizeWikiFilename("../Agent: Memory?.md"), "Agent Memory");
  assert.equal(
    buildWritableWikiPath("Agent: Memory?"),
    "KnowledgeCuratorPhase1Test/wiki/Agent Memory.md"
  );
  assert.throws(() => buildWritableWikiPath("../"));
});
