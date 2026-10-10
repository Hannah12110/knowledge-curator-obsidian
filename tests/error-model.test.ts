import test from "node:test";
import assert from "node:assert/strict";
import { createCuratorError } from "../src/types/errors";

test("error model exposes safe user copy and keeps technical detail out of message", () => {
  const error = createCuratorError("search", {
    code: "search_http_429",
    userMessage: "搜索请求过于频繁，请稍后重试。",
    message: "raw provider body with internal detail"
  }, "搜索失败。");
  assert.equal(error.stage, "search");
  assert.equal(error.message, "搜索请求过于频繁，请稍后重试。");
  assert.equal(error.retryable, true);
  assert.equal(error.message.includes("raw provider"), false);
  assert.equal(error.technicalDetail?.includes("raw provider"), true);
});
