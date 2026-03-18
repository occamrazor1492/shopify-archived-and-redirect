import type { FailedSkuRecord, ProductExportRow } from "./types";

type RawRow = Record<string, string>;

interface RawSheet {
  name: string;
  rows: RawRow[];
}

const FAILURE_SKU_ALIASES = [
  "主sku编号",
  "主sku",
  "sku",
  "sku编号",
  "sku id",
  "skuid",
  "main sku",
  "master sku",
  "parent sku",
  "variant sku",
];

const FAILURE_LINK_ALIASES = ["失败链接", "链接", "url", "link"];
const FAILURE_ID_ALIASES = ["唯一id", "unique id", "id", "编号"];

const PRODUCT_HANDLE_ALIASES = ["Handle", "handle"];
const PRODUCT_TITLE_ALIASES = ["Title", "title"];
const PRODUCT_STATUS_ALIASES = ["Status", "status"];
const PRODUCT_PUBLISHED_ALIASES = ["Published", "published"];
const PRODUCT_VARIANT_SKU_ALIASES = ["Variant SKU", "variant sku"];
const PRODUCT_INVENTORY_ALIASES = [
  "Variant Inventory Qty",
  "variant inventory qty",
  "inventory qty",
];

export async function readWorkbookRows(file: File): Promise<RawSheet[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    raw: false,
    cellDates: false,
    dense: false,
  });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });

    return {
      name: sheetName,
      rows: rows
        .map((row) => cleanRawRow(row))
        .filter((row) => Object.values(row).some((value) => value !== "")),
    };
  }).filter((sheet) => sheet.rows.length);
}

export async function parseFailedSkuFile(file: File): Promise<FailedSkuRecord[]> {
  const sheets = await readWorkbookRows(file);
  const firstSheet = sheets[0];

  if (!firstSheet) {
    throw new Error(`${file.name} 没有可读取的数据表。`);
  }

  const headers = Object.keys(firstSheet.rows[0] ?? {});
  const skuKey = pickHeader(headers, FAILURE_SKU_ALIASES);
  const linkKey = pickHeader(headers, FAILURE_LINK_ALIASES);
  const idKey = pickHeader(headers, FAILURE_ID_ALIASES);

  if (!skuKey) {
    throw new Error(`${file.name} 缺少失败 SKU 列，请至少包含“主sku编号”或 SKU 类字段。`);
  }

  return firstSheet.rows
    .map((row, index) => {
      const sku = cleanSku(row[skuKey]);

      if (!sku) {
        return null;
      }

      return {
        rowId: `${file.name}:${index + 2}`,
        sourceFile: file.name,
        sourceRow: index + 2,
        sku,
        failureLink: linkKey ? row[linkKey] ?? "" : "",
        uniqueId: idKey ? row[idKey] ?? "" : "",
      } satisfies FailedSkuRecord;
    })
    .filter((row): row is FailedSkuRecord => Boolean(row));
}

export async function parseProductExportFiles(files: File[]): Promise<ProductExportRow[]> {
  const results = await Promise.all(files.map((file) => parseProductExportFile(file)));
  return results.flat();
}

export function normalizeSku(value: string): string {
  return cleanSku(value).replaceAll(/\s+/g, "").toUpperCase();
}

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[_/.\-]+/g, " ")
    .replaceAll(/[^\p{L}\p{N}\s]+/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function isTruthyPublished(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

async function parseProductExportFile(file: File): Promise<ProductExportRow[]> {
  const sheets = await readWorkbookRows(file);

  return sheets.flatMap((sheet) => {
    const headers = Object.keys(sheet.rows[0] ?? {});
    const handleKey = pickHeader(headers, PRODUCT_HANDLE_ALIASES);
    const titleKey = pickHeader(headers, PRODUCT_TITLE_ALIASES);
    const statusKey = pickHeader(headers, PRODUCT_STATUS_ALIASES);
    const publishedKey = pickHeader(headers, PRODUCT_PUBLISHED_ALIASES);
    const variantSkuKey = pickHeader(headers, PRODUCT_VARIANT_SKU_ALIASES);
    const inventoryKey = pickHeader(headers, PRODUCT_INVENTORY_ALIASES);

    if (!handleKey || !titleKey || !variantSkuKey) {
      throw new Error(
        `${file.name} 缺少必要字段，至少需要 Handle、Title、Variant SKU 三列。`,
      );
    }

    return sheet.rows
      .map((row, index) => {
        const variantSku = cleanSku(row[variantSkuKey]);

        if (!variantSku) {
          return null;
        }

        return {
          rowId: `${file.name}:${sheet.name}:${index + 2}`,
          sourceFile: file.name,
          sourceRow: index + 2,
          handle: row[handleKey] ?? "",
          title: row[titleKey] ?? "",
          status: statusKey ? row[statusKey] ?? "" : "",
          published: publishedKey ? row[publishedKey] ?? "" : "",
          variantSku,
          variantInventoryQty: toNumber(inventoryKey ? row[inventoryKey] : ""),
        } satisfies ProductExportRow;
      })
      .filter((row): row is ProductExportRow => Boolean(row));
  });
}

function cleanRawRow(row: Record<string, unknown>): RawRow {
  const normalized: RawRow = {};

  for (const [key, value] of Object.entries(row)) {
    normalized[String(key).trim()] = value == null ? "" : String(value).trim();
  }

  return normalized;
}

function pickHeader(headers: string[], aliases: string[]): string | undefined {
  const exactMap = new Map(headers.map((header) => [normalizeHeader(header), header]));

  for (const alias of aliases) {
    const matched = exactMap.get(normalizeHeader(alias));

    if (matched) {
      return matched;
    }
  }

  for (const header of headers) {
    const normalizedHeader = normalizeHeader(header);

    if (aliases.some((alias) => normalizedHeader.includes(normalizeHeader(alias)))) {
      return header;
    }
  }

  return undefined;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[()\[\]{}/\\_\-\s]+/g, "")
    .trim();
}

function cleanSku(value: string): string {
  return value.trim().replaceAll(/\.0+$/g, "");
}

function toNumber(value: string): number {
  const normalized = value.trim().replaceAll(",", "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
