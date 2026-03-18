import {
  isTruthyPublished,
  normalizeHandle,
  normalizeSearchText,
  normalizeSku,
  normalizeStatus,
} from "./parse";
import type {
  AnalysisResult,
  AnalysisRules,
  DecisionRow,
  FailedSkuRecord,
  ProductExportRow,
  ShopifyProductDetail,
  TableArtifact,
} from "./types";

interface ProductAggregate {
  handle: string;
  title: string;
  status: string;
  published: string;
  inventoryQty: number;
  sourceFiles: Set<string>;
  variantSkus: Set<string>;
}

interface CatalogCandidate {
  handleKey: string;
  handle: string;
  title: string;
  status: string;
  published: string;
  titleTokens: Set<string>;
  handleTokens: Set<string>;
  bigrams: Set<string>;
  searchTokens: string[];
}

interface MatchCandidate {
  targetHandle: string;
  targetTitle: string;
  targetPath: string;
  score: number;
  sharedTokens: string[];
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "your",
  "this",
  "that",
  "new",
  "sale",
  "shop",
]);

export function analyzeData(input: {
  failures: FailedSkuRecord[];
  productRows: ProductExportRow[];
  shopifyDetails: Record<string, ShopifyProductDetail>;
  rules: AnalysisRules;
  liveLookupEnabled: boolean;
}): AnalysisResult {
  const { failures, productRows, shopifyDetails, rules, liveLookupEnabled } = input;
  const skuMap = buildSkuMap(productRows);
  const catalog = buildCatalog(productRows);
  const finalSaleKeywords = rules.finalSaleKeywords
    .map((keyword) => normalizeSearchText(keyword))
    .filter(Boolean);

  const namedSummaryRows: DecisionRow[] = [];
  const inventorySplitRows: DecisionRow[] = [];
  const shopifyDetailRows: DecisionRow[] = [];
  const ignoredRows: DecisionRow[] = [];
  const archiveRows: DecisionRow[] = [];
  const redirectRows: DecisionRow[] = [];
  const unmatchedRows: DecisionRow[] = [];
  const lowScoreRows: DecisionRow[] = [];
  const warnings: string[] = [];

  const redirectNeededRows: DecisionRow[] = [];
  const now = new Date();
  let mappedSkuCount = 0;
  let missingSkuCount = 0;

  if (!liveLookupEnabled) {
    warnings.push("未提供 Shopify 实时凭证，createdAt 无法补齐，规则判断会偏保守。");
  }

  for (const failure of failures) {
    const aggregate = skuMap.get(normalizeSku(failure.sku));

    if (!aggregate) {
      missingSkuCount += 1;
      unmatchedRows.push(
        buildRow({
          failure,
          decision: "unmatched_sku",
          reason: "未在 products_export 文件中找到对应 SKU。",
        }),
      );
      namedSummaryRows.push(
        buildRow({
          failure,
          decision: "unmatched_sku",
          reason: "未在 products_export 文件中找到对应 SKU。",
        }),
      );
      continue;
    }

    mappedSkuCount += 1;
    const handleKey = normalizeHandle(aggregate.handle);
    const live = shopifyDetails[handleKey];
    const sourceTitle = live?.title || aggregate.title;
    const exportStatus = normalizeStatus(aggregate.status);
    const shopifyStatus = normalizeStatus(live?.status || aggregate.status);
    const createdAt = live?.createdAt ?? "";
    const publishedAt = live?.publishedAt ?? "";
    const ageDays = createdAt ? diffDays(now, createdAt) : null;
    const baseRow = buildRow({
      failure,
      aggregate,
      live,
      decision: "mapped",
      reason: "已映射到商品。",
      sourceTitle,
      exportStatus,
      shopifyStatus,
      createdAt,
      publishedAt,
      ageDays,
    });

    namedSummaryRows.push(baseRow);
    inventorySplitRows.push({
      ...baseRow,
      decision:
        aggregate.inventoryQty <= rules.inventoryThreshold
          ? "inventory_lte_threshold"
          : "inventory_gt_threshold",
      reason:
        aggregate.inventoryQty <= rules.inventoryThreshold
          ? `库存 ${aggregate.inventoryQty} <= ${rules.inventoryThreshold}`
          : `库存 ${aggregate.inventoryQty} > ${rules.inventoryThreshold}`,
    });
    shopifyDetailRows.push({
      ...baseRow,
      decision: live ? "shopify_enriched" : "shopify_missing",
      reason: live ? "已补齐 Shopify 实时状态。" : "未查到 Shopify 实时详情，使用导出数据兜底。",
    });

    if (containsFinalSale(sourceTitle, finalSaleKeywords)) {
      ignoredRows.push({
        ...baseRow,
        decision: "ignored_final_sale",
        reason: "标题命中 final sale 排除词。",
      });
      continue;
    }

    if (!createdAt) {
      ignoredRows.push({
        ...baseRow,
        decision: "ignored_missing_created_at",
        reason: "缺少 Shopify createdAt，无法判断是否超过天数阈值。",
      });
      continue;
    }

    if (ageDays !== null && ageDays < rules.daysThreshold) {
      ignoredRows.push({
        ...baseRow,
        decision: "ignored_recent_product",
        reason: `商品创建于 ${ageDays} 天前，小于阈值 ${rules.daysThreshold} 天。`,
      });
      continue;
    }

    if (aggregate.inventoryQty > rules.inventoryThreshold) {
      if (shopifyStatus === "active") {
        archiveRows.push({
          ...baseRow,
          decision: "archive_only",
          reason: "库存高于阈值，且商品仍为 active，纳入归档执行。",
        });
      } else if (shopifyStatus === "archived") {
        ignoredRows.push({
          ...baseRow,
          decision: "ignored_already_archived",
          reason: "库存高于阈值，但商品已经 archived。",
        });
      } else {
        ignoredRows.push({
          ...baseRow,
          decision: "ignored_unsupported_status",
          reason: `库存高于阈值，但状态 ${shopifyStatus || "unknown"} 不在 MVP 处理范围。`,
        });
      }

      continue;
    }

    if (shopifyStatus === "active") {
      redirectNeededRows.push({
        ...baseRow,
        decision: "archive_and_redirect",
        reason: "库存低于等于阈值，需归档并重定向。",
      });
      continue;
    }

    if (shopifyStatus === "archived") {
      redirectNeededRows.push({
        ...baseRow,
        decision: "redirect_only",
        reason: "库存低于等于阈值，商品已归档，只需重定向。",
      });
      continue;
    }

    ignoredRows.push({
      ...baseRow,
      decision: "ignored_unsupported_status",
      reason: `库存低于等于阈值，但状态 ${shopifyStatus || "unknown"} 不在 MVP 处理范围。`,
    });
  }

  const excludedHandles = new Set<string>([
    ...archiveRows.map((row) => normalizeHandle(row.handle)),
    ...redirectNeededRows.map((row) => normalizeHandle(row.handle)),
  ]);
  const targetPool = catalog.filter(
    (candidate) =>
      normalizeStatus(candidate.status) === "active" &&
      !containsFinalSale(candidate.title, finalSaleKeywords) &&
      !excludedHandles.has(candidate.handleKey) &&
      (isTruthyPublished(candidate.published) || candidate.published === ""),
  );
  const tokenIndex = buildTokenIndex(targetPool);

  for (const row of redirectNeededRows) {
    const match = matchRedirectTarget(row, targetPool, tokenIndex);

    if (!match) {
      unmatchedRows.push({
        ...row,
        reason: "未找到合适的 active 商品作为重定向目标。",
      });
      continue;
    }

    if (match.score < rules.redirectThreshold) {
      lowScoreRows.push({
        ...row,
        targetHandle: match.targetHandle,
        targetTitle: match.targetTitle,
        targetPath: match.targetPath,
        similarityScore: Number(match.score.toFixed(4)),
        sharedTokens: match.sharedTokens.join(" | "),
        reason: `重定向候选分数 ${match.score.toFixed(2)} 低于阈值 ${rules.redirectThreshold}。`,
      });
      continue;
    }

    const matchedRow: DecisionRow = {
      ...row,
      targetHandle: match.targetHandle,
      targetTitle: match.targetTitle,
      targetPath: match.targetPath,
      similarityScore: Number(match.score.toFixed(4)),
      sharedTokens: match.sharedTokens.join(" | "),
      reason: `自动匹配成功，分数 ${match.score.toFixed(2)}。`,
    };

    redirectRows.push(matchedRow);

    if (row.decision === "archive_and_redirect") {
      archiveRows.push({
        ...matchedRow,
        reason: "归档动作已通过重定向匹配校验，可安全执行。",
      });
    }
  }

  if (redirectNeededRows.length && !targetPool.length) {
    warnings.push("没有可用的 active 商品目标池，所有需要重定向的商品都会落入未匹配或待复核。");
  }

  const tables: TableArtifact[] = [
    table("named-summary", "失败 SKU 命名汇总表", "failed-sku-summary.csv", namedSummaryRows),
    table("inventory-split", "库存分流表", "inventory-split.csv", inventorySplitRows),
    table("shopify-details", "Shopify 商品明细表", "shopify-product-details.csv", shopifyDetailRows),
    table("archive", "归档执行表", "archive-execution.csv", archiveRows),
    table("redirect", "重定向执行表", "redirect-execution.csv", redirectRows),
    table("unmatched", "未匹配表", "redirect-unmatched.csv", unmatchedRows),
    table("low-score", "低分待复核表", "redirect-low-score-review.csv", lowScoreRows),
    table("ignored", "规则排除表", "ignored-by-rules.csv", ignoredRows),
  ];

  return {
    summary: {
      failedSkuCount: failures.length,
      mappedSkuCount,
      missingSkuCount,
      inventoryRedirectCandidateCount: redirectNeededRows.length,
      archiveReadyCount: archiveRows.length,
      redirectReadyCount: redirectRows.length,
      ignoredCount: ignoredRows.length,
      unmatchedCount: unmatchedRows.length,
      lowScoreCount: lowScoreRows.length,
      shopifyLookupCount: Object.keys(shopifyDetails).length,
    },
    warnings,
    namedSummaryRows,
    inventorySplitRows,
    shopifyDetailRows,
    ignoredRows,
    archiveRows,
    redirectRows,
    unmatchedRows,
    lowScoreRows,
    tables,
  };
}

function buildSkuMap(productRows: ProductExportRow[]): Map<string, ProductAggregate> {
  const skuMap = new Map<string, ProductAggregate>();

  for (const row of productRows) {
    const skuKey = normalizeSku(row.variantSku);

    if (!skuKey) {
      continue;
    }

    const current = skuMap.get(skuKey) ?? {
      handle: row.handle,
      title: row.title,
      status: row.status,
      published: row.published,
      inventoryQty: 0,
      sourceFiles: new Set<string>(),
      variantSkus: new Set<string>(),
    };

    current.handle ||= row.handle;
    current.title ||= row.title;
    current.status ||= row.status;
    current.published ||= row.published;
    current.inventoryQty += row.variantInventoryQty;
    current.sourceFiles.add(row.sourceFile);
    current.variantSkus.add(row.variantSku);
    skuMap.set(skuKey, current);
  }

  return skuMap;
}

function buildCatalog(productRows: ProductExportRow[]): CatalogCandidate[] {
  const byHandle = new Map<string, ProductAggregate>();

  for (const row of productRows) {
    const handleKey = normalizeHandle(row.handle);

    if (!handleKey) {
      continue;
    }

    const current = byHandle.get(handleKey) ?? {
      handle: row.handle,
      title: row.title,
      status: row.status,
      published: row.published,
      inventoryQty: 0,
      sourceFiles: new Set<string>(),
      variantSkus: new Set<string>(),
    };

    current.handle ||= row.handle;
    current.title ||= row.title;
    current.status ||= row.status;
    current.published ||= row.published;
    current.inventoryQty += row.variantInventoryQty;
    current.sourceFiles.add(row.sourceFile);
    if (row.variantSku) {
      current.variantSkus.add(row.variantSku);
    }
    byHandle.set(handleKey, current);
  }

  return [...byHandle.values()].map((product) => {
    const titleTokens = buildWordSet(product.title);
    const handleTokens = buildWordSet(product.handle);

    return {
      handleKey: normalizeHandle(product.handle),
      handle: product.handle,
      title: product.title,
      status: product.status,
      published: product.published,
      titleTokens,
      handleTokens,
      bigrams: buildBigrams(product.title),
      searchTokens: [...new Set([...titleTokens, ...handleTokens])],
    } satisfies CatalogCandidate;
  });
}

function buildRow(input: {
  failure: FailedSkuRecord;
  aggregate?: ProductAggregate;
  live?: ShopifyProductDetail;
  decision: string;
  reason: string;
  sourceTitle?: string;
  exportStatus?: string;
  shopifyStatus?: string;
  createdAt?: string;
  publishedAt?: string;
  ageDays?: number | null;
}): DecisionRow {
  const { failure, aggregate, live } = input;

  return {
    rowId: failure.rowId,
    sourceFile: failure.sourceFile,
    sourceRow: failure.sourceRow,
    failureSku: failure.sku,
    uniqueId: failure.uniqueId,
    failureLink: failure.failureLink,
    handle: aggregate?.handle ?? "",
    sourceTitle: input.sourceTitle ?? aggregate?.title ?? live?.title ?? "",
    inventoryQty: aggregate?.inventoryQty ?? 0,
    exportStatus: input.exportStatus ?? normalizeStatus(aggregate?.status ?? ""),
    shopifyStatus: input.shopifyStatus ?? normalizeStatus(live?.status ?? aggregate?.status ?? ""),
    productId: live?.productId ?? "",
    createdAt: input.createdAt ?? live?.createdAt ?? "",
    publishedAt: input.publishedAt ?? live?.publishedAt ?? "",
    ageDays: input.ageDays ?? null,
    decision: input.decision,
    reason: input.reason,
    sourcePath: aggregate?.handle ? productPath(aggregate.handle) : "",
    targetHandle: "",
    targetTitle: "",
    targetPath: "",
    similarityScore: null,
    sharedTokens: "",
  };
}

function matchRedirectTarget(
  row: DecisionRow,
  candidates: CatalogCandidate[],
  tokenIndex: Map<string, Set<string>>,
): MatchCandidate | null {
  const rowTitleTokens = buildWordSet(row.sourceTitle);
  const rowHandleTokens = buildWordSet(row.handle);
  const rowBigrams = buildBigrams(`${row.sourceTitle} ${row.handle}`);
  const searchTokens = [...new Set([...rowTitleTokens, ...rowHandleTokens])];
  const scoreVotes = new Map<string, number>();

  for (const token of searchTokens) {
    const handles = tokenIndex.get(token);

    if (!handles) {
      continue;
    }

    for (const handleKey of handles) {
      scoreVotes.set(handleKey, (scoreVotes.get(handleKey) ?? 0) + 1);
    }
  }

  const shortlist = scoreVotes.size
    ? [...scoreVotes.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 120)
        .map(([handleKey]) => handleKey)
    : [];

  const candidatePool =
    shortlist.length > 0
      ? candidates.filter((candidate) => shortlist.includes(candidate.handleKey))
      : candidates.length <= 4000
        ? candidates
        : candidates.slice(0, 1500);

  let best: MatchCandidate | null = null;

  for (const candidate of candidatePool) {
    if (candidate.handleKey === normalizeHandle(row.handle)) {
      continue;
    }

    const titleScore = jaccard(rowTitleTokens, candidate.titleTokens);
    const handleScore = jaccard(rowHandleTokens, candidate.handleTokens);
    const bigramScore = jaccard(rowBigrams, candidate.bigrams);
    const sharedTokens = intersect(rowTitleTokens, candidate.titleTokens);
    const containsBonus =
      normalizeSearchText(candidate.title).includes(normalizeSearchText(row.sourceTitle)) ||
      normalizeSearchText(row.sourceTitle).includes(normalizeSearchText(candidate.title))
        ? 0.08
        : 0;
    const score = Math.min(
      1,
      titleScore * 0.5 + bigramScore * 0.35 + handleScore * 0.15 + containsBonus,
    );

    if (!best || score > best.score) {
      best = {
        targetHandle: candidate.handle,
        targetTitle: candidate.title,
        targetPath: productPath(candidate.handle),
        score,
        sharedTokens,
      };
    }
  }

  return best;
}

function buildTokenIndex(candidates: CatalogCandidate[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    for (const token of candidate.searchTokens) {
      const handles = index.get(token) ?? new Set<string>();
      handles.add(candidate.handleKey);
      index.set(token, handles);
    }
  }

  return index;
}

function buildWordSet(value: string): Set<string> {
  const normalized = normalizeSearchText(value);

  return new Set(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  );
}

function buildBigrams(value: string): Set<string> {
  const compact = normalizeSearchText(value).replaceAll(" ", "");
  const grams = new Set<string>();

  if (!compact) {
    return grams;
  }

  if (compact.length < 3) {
    grams.add(compact);
    return grams;
  }

  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }

  return grams;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) {
    return 0;
  }

  const shared = intersect(left, right).length;
  const union = new Set([...left, ...right]).size;

  return union === 0 ? 0 : shared / union;
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  const shared: string[] = [];

  for (const token of left) {
    if (right.has(token)) {
      shared.push(token);
    }
  }

  return shared;
}

function containsFinalSale(title: string, keywords: string[]): boolean {
  const normalizedTitle = normalizeSearchText(title);
  return keywords.some((keyword) => normalizedTitle.includes(keyword));
}

function diffDays(now: Date, createdAt: string): number {
  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) {
    return 0;
  }

  const milliseconds = now.getTime() - createdTime;
  return Math.floor(milliseconds / (1000 * 60 * 60 * 24));
}

function productPath(handle: string): string {
  return `/products/${handle}`;
}

function table(
  key: string,
  label: string,
  filename: string,
  rows: Array<Record<string, unknown>>,
): TableArtifact {
  return { key, label, filename, rows };
}
