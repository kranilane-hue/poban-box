#!/usr/bin/env node
const { execSync } = require("child_process");

function getDiffFiles(baseRef, headRef) {
  const cmd = `git diff --name-only ${baseRef}...${headRef}`;
  const output = execSync(cmd, { encoding: "utf8" }).trim();
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean);
}

function isManifestFile(file) {
  return (
    file.startsWith("app/contracts/") ||
    file === "app/docs/RC001-统一清单权威源与生成链路.md" ||
    file === "app/docs/RC001-版本语义与兼容规则.md" ||
    file === "app/docs/RC001-错误码分段与弃用策略.md"
  );
}

function isImplementationFile(file) {
  if (!file.startsWith("app/")) return false;
  if (file.startsWith("app/docs/")) return false;
  if (file.startsWith("app/contracts/")) return false;
  if (file.startsWith("app/tools/")) return false;
  return /\.(js|ts|tsx|jsx|json|xml|html|css|jsx)$/i.test(file);
}

function main() {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
  const head = process.env.GITHUB_SHA || "HEAD";
  const files = getDiffFiles(base, head);

  const hasImplChange = files.some(isImplementationFile);
  const hasManifestChange = files.some(isManifestFile);

  if (hasImplChange && !hasManifestChange) {
    console.error("manifest-first-gate failed: 检测到实现变更，但未检测到清单/规则变更。");
    console.error("请先修改 app/contracts 或 RC001 规则文档，再提交实现改动。");
    process.exit(1);
  }

  console.log("manifest-first-gate passed.");
}

main();
