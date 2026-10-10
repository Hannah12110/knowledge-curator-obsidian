import test from "node:test";
import assert from "node:assert/strict";
import {
  createRetrievalScopeSnapshot,
  isPathInKnowledgeScope,
  isPathInsideFolder
} from "../src/services/path-scope";

const SCOPE = createRetrievalScopeSnapshot({
  inboxFolder: "KnowledgeCuratorPhase1Test/inbox",
  wikiFolder: "KnowledgeCuratorPhase1Test/wiki",
  rawFolders: [
    "KnowledgeCuratorPhase1Test/raw-技术",
    "KnowledgeCuratorPhase1Test/raw-产品"
  ]
});

test("same-name Wiki outside the configured folder is excluded", () => {
  assert.equal(
    isPathInKnowledgeScope("KnowledgeCuratorPhase1Test/wiki/Test.md", SCOPE),
    true
  );
  assert.equal(
    isPathInKnowledgeScope("03_公众号阅读/wiki/Test.md", SCOPE),
    false
  );
});

test("same-name Raw outside the configured folders is excluded", () => {
  assert.equal(
    isPathInKnowledgeScope("KnowledgeCuratorPhase1Test/raw-技术/Test.md", SCOPE),
    true
  );
  assert.equal(
    isPathInKnowledgeScope("KnowledgeCuratorPhase1Test/raw-产品/Test.md", SCOPE),
    true
  );
  assert.equal(
    isPathInKnowledgeScope("03_公众号阅读/raw-技术/Test.md", SCOPE),
    false
  );
});

test("similar Inbox folder names do not cross the path boundary", () => {
  assert.equal(
    isPathInsideFolder(
      "KnowledgeCuratorPhase1Test/inbox/Test.md",
      SCOPE.inboxFolder
    ),
    true
  );
  assert.equal(
    isPathInsideFolder(
      "KnowledgeCuratorPhase1Test/inbox-old/Test.md",
      SCOPE.inboxFolder
    ),
    false
  );
});
