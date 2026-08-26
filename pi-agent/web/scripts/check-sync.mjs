#!/usr/bin/env node
// 检查 web mdx（权威源）与下载版 md（快照）的内容漂移。
// 配对规则见仓库 CLAUDE.md「把 md 改动同步到 web mdx」：
//   pi_source_dive/typescript/第N章-*.md  ↔ src/content/modules/chNN-*.mdx
//   pi_source_dive/python/第N章-*.md      ↔ src/content/modules/chNN-*.python.mdx
//   pi_sdk_learn/docs/第N章-*.md          ↔ src/content/modules/prNN-*.mdx
// 用法：cd pi-agent/web && npm run check:sync
// 退出码：0 = 全部同步；1 = 存在漂移；2 = 配对缺失

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mdRoots = [
  { dir: join(webRoot, '..', 'pi_source_dive', 'typescript'), prefix: 'ch', python: false },
  { dir: join(webRoot, '..', 'pi_source_dive', 'python'), prefix: 'ch', python: true },
  { dir: join(webRoot, '..', 'pi_sdk_learn', 'docs'), prefix: 'pr', python: false },
];
const mdxDir = join(webRoot, 'src', 'content', 'modules');

// ---------- 解析：把文件拆成「代码围栏序列 + 归一化散文行」 ----------

function parseFile(raw, { isMdx }) {
  const text = raw.replace(/\r\n?/g, '\n');
  let body = text;

  if (isMdx) {
    // 剥离文件头 frontmatter（--- ... ---）
    body = body.replace(/^---\n[\s\S]*?\n---\n/, '');
    // 只剥离真正的组件 import 行（指向 .astro 的相对导入），不动代码块里的 import
    body = body
      .split('\n')
      .filter((line) => !/^import\s+\w+\s+from\s+['"][^'"]*\.astro['"];?\s*$/.test(line))
      .join('\n');
  } else {
    // 剥离 md 顶部的章节大标题（mdx 标题由 frontmatter 提供）
    body = body.replace(/^\s*# 第.+章[^\n]*\n/, '');
    // 实战篇 md 标题后紧跟一条 --- 分隔线，mdx 里这行也一并删了
    body = body.replace(/^(\s*\n)*---\s*\n/, '');
  }

  const fences = [];
  const proseLines = [];
  const lines = body.split('\n');
  let inFence = false;
  let fence = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        fences.push(fence);
        fence = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fence.push(line.replace(/\s+$/, ''));
    } else {
      const norm = normalizeProse(line);
      if (norm) proseLines.push(norm);
    }
  }
  if (inFence) fences.push(fence); // 未闭合围栏也收尾，避免丢内容
  return { fences, proseLines };
}

// md 与 mdx 的已知格式差异在这里抹平（见 CLAUDE.md 的 md→mdx 转换规则）
function normalizeProse(line) {
  return (
    line
      // 图片：![alt](任意路径/xxx.svg) → @[xxx.svg]
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, url) => `@[${url.split('/').pop()}]`)
      // Diagram 组件：<Diagram file="/assets/xxx.svg" ... /> → @[xxx.svg]
      .replace(/<Diagram\b[^>]*file="([^"]*)"[^>]*\/>/g, (_m, file) => `@[${file.split('/').pop()}]`)
      // 链接目标：md 相对路径 vs mdx 绝对 URL，只比链接文字
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '[$1]')
      // mdx 把裸 {...} 包进反引号是格式要求，反引号本身不算内容差异
      .replace(/`([^`]*)`/g, '$1')
      // <br> 与 <br/> 等价
      .replace(/<br\s*>/gi, '<br/>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ---------- 对比 ----------

function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { index: i, a: a[i], b: b[i] };
  }
  return null;
}

function comparePair(mdPath, mdxPath) {
  const md = parseFile(readFileSync(mdPath, 'utf8'), { isMdx: false });
  const mdx = parseFile(readFileSync(mdxPath, 'utf8'), { isMdx: true });
  const problems = [];

  if (md.fences.length !== mdx.fences.length) {
    problems.push(`代码块数量不一致：md ${md.fences.length} 个 vs mdx ${mdx.fences.length} 个`);
  } else {
    for (let i = 0; i < md.fences.length; i++) {
      if (md.fences[i].join('\n') !== mdx.fences[i].join('\n')) {
        const d = firstDiff(md.fences[i], mdx.fences[i]);
        problems.push(`第 ${i + 1} 个代码块内容不同（约第 ${d.index + 1} 行）\n    md : ${d.a ?? '(缺失)'}\n    mdx: ${d.b ?? '(缺失)'}`);
        break;
      }
    }
  }

  const d = firstDiff(md.proseLines, mdx.proseLines);
  if (d) {
    problems.push(`正文不同（md 第 ${d.index + 1} 行有效内容）\n    md : ${d.a ?? '(缺失)'}\n    mdx: ${d.b ?? '(缺失)'}`);
  }
  return problems;
}

// ---------- 主流程 ----------

const mdxFiles = readdirSync(mdxDir).filter((f) => f.endsWith('.mdx'));
const paired = new Set();
let drift = 0;
let missing = 0;
const reports = [];

for (const root of mdRoots) {
  let mdFiles;
  try {
    mdFiles = readdirSync(root.dir).filter((f) => f.endsWith('.md'));
  } catch {
    reports.push(`!! 找不到目录 ${root.dir}`);
    missing++;
    continue;
  }
  for (const mdFile of mdFiles) {
    const m = mdFile.match(/^第(\d+)章/);
    if (!m) continue;
    const no = String(Number(m[1])).padStart(2, '0');
    const target = mdxFiles.find(
      (f) =>
        f.startsWith(`${root.prefix}${no}-`) &&
        (root.python ? f.endsWith('.python.mdx') : !f.endsWith('.python.mdx')),
    );
    if (!target) {
      reports.push(`!! ${mdFile} 没有对应的 mdx（期望 ${root.prefix}${no}-*.mdx）`);
      missing++;
      continue;
    }
    paired.add(target);
    const problems = comparePair(join(root.dir, mdFile), join(mdxDir, target));
    if (problems.length) {
      drift++;
      reports.push(`⟿ ${mdFile}  ↔  ${target}\n  - ` + problems.join('\n  - '));
    }
  }
}

for (const f of mdxFiles) {
  if (!paired.has(f)) {
    reports.push(`!! ${f} 没有对应的 md 源文件`);
    missing++;
  }
}

console.log(`[check:sync] 检查 ${paired.size + Math.max(0, mdxFiles.length - paired.size)} 对 md/mdx：同步 ${paired.size - drift}，漂移 ${drift}，配对缺失 ${missing}\n`);
if (reports.length) console.log(reports.join('\n\n'));

if (missing) process.exit(2);
if (drift) process.exit(1);
console.log('[check:sync] 全部同步 ✅');
