/**
 * query-data.ts — DataAgent 主线工具：查询销售数据
 *
 * 按条件过滤 sales.csv 的行（类似 SQL 的 WHERE）。
 * 全教程从第 5 章起复用这把工具。
 *
 * 数据集 shared/data/sales.csv，字段：日期 / 产品 / 地区 / 销售额 / 数量 / 销售人员
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── 读 sales.csv（内联解析，保持工具自包含）──
function loadSales(): { headers: string[]; rows: Record<string, string>[] } {
  const filePath = join(process.cwd(), "shared/data/sales.csv");
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] ?? ""));
    return row;
  });
  return { headers, rows };
}

// ── 按条件过滤（= != > < >= <= contains）──
function filterRows(
  rows: Record<string, string>[],
  column: string,
  operator: string,
  value: string,
): Record<string, string>[] {
  return rows.filter((row) => {
    const cell = row[column];
    if (cell === undefined) return false;
    const numCell = Number(cell);
    const numValue = Number(value);
    switch (operator) {
      case "=": return cell === value;
      case "!=": return cell !== value;
      case ">": return !isNaN(numCell) && !isNaN(numValue) && numCell > numValue;
      case "<": return !isNaN(numCell) && !isNaN(numValue) && numCell < numValue;
      case ">=": return !isNaN(numCell) && !isNaN(numValue) && numCell >= numValue;
      case "<=": return !isNaN(numCell) && !isNaN(numValue) && numCell <= numValue;
      case "contains": return cell.includes(value);
      default: return false;
    }
  });
}

export const queryDataTool = defineTool({
  name: "query_data",
  description:
    "查询销售数据（sales.csv）。按指定列的条件过滤，返回匹配的行。字段：日期、产品、地区、销售额、数量、销售人员。",
  parameters: Type.Object({
    column: Type.String({ description: "要过滤的列名，如：地区、产品、销售人员、销售额" }),
    operator: Type.Union(
      [Type.Literal("="), Type.Literal("!="), Type.Literal(">"), Type.Literal("<"),
       Type.Literal(">="), Type.Literal("<="), Type.Literal("contains")],
      { description: "比较运算符：= != > < >= <= contains" },
    ),
    value: Type.String({ description: "过滤条件的值" }),
    limit: Type.Optional(Type.Number({ description: "最多返回行数，默认 20" })),
  }),

  async execute(_id, params) {
    const { headers, rows } = loadSales();

    // 列名不存在 → 返回可用列，让 LLM 换个列名重试
    if (!headers.includes(params.column)) {
      return {
        content: [{ type: "text", text: `列名 "${params.column}" 不存在。可用列：${headers.join("、")}` }],
        isError: true,
      };
    }

    const filtered = filterRows(rows, params.column, params.operator, params.value);
    const limit = params.limit ?? 20;
    const limited = filtered.slice(0, limit);

    let text = `查询条件：${params.column} ${params.operator} ${params.value}\n匹配 ${filtered.length}/${rows.length} 行\n\n`;
    text += headers.join(", ") + "\n";
    for (const row of limited) text += headers.map((h) => row[h]).join(", ") + "\n";
    if (filtered.length > limit) text += `\n... 还有 ${filtered.length - limit} 行未显示`;

    return { content: [{ type: "text", text }] };
  },
});
