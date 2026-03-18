export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
}

export interface AnalysisRules {
  daysThreshold: number;
  inventoryThreshold: number;
  redirectThreshold: number;
  finalSaleKeywords: string[];
  autoExecute: boolean;
}

export interface FailedSkuRecord {
  rowId: string;
  sourceFile: string;
  sourceRow: number;
  sku: string;
  failureLink: string;
  uniqueId: string;
}

export interface ProductExportRow {
  rowId: string;
  sourceFile: string;
  sourceRow: number;
  handle: string;
  title: string;
  status: string;
  published: string;
  variantSku: string;
  variantInventoryQty: number;
}

export interface ShopifyProductDetail {
  productId: string;
  handle: string;
  title: string;
  status: string;
  createdAt: string;
  publishedAt: string;
}

export interface DecisionRow extends Record<string, unknown> {
  rowId: string;
  sourceFile: string;
  sourceRow: number;
  failureSku: string;
  uniqueId: string;
  failureLink: string;
  handle: string;
  sourceTitle: string;
  inventoryQty: number;
  exportStatus: string;
  shopifyStatus: string;
  productId: string;
  createdAt: string;
  publishedAt: string;
  ageDays: number | null;
  decision: string;
  reason: string;
  sourcePath: string;
  targetHandle: string;
  targetTitle: string;
  targetPath: string;
  similarityScore: number | null;
  sharedTokens: string;
}

export interface TableArtifact {
  key: string;
  label: string;
  filename: string;
  rows: Array<Record<string, unknown>>;
}

export interface AnalysisSummary {
  failedSkuCount: number;
  mappedSkuCount: number;
  missingSkuCount: number;
  inventoryRedirectCandidateCount: number;
  archiveReadyCount: number;
  redirectReadyCount: number;
  ignoredCount: number;
  unmatchedCount: number;
  lowScoreCount: number;
  shopifyLookupCount: number;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  warnings: string[];
  namedSummaryRows: DecisionRow[];
  inventorySplitRows: DecisionRow[];
  shopifyDetailRows: DecisionRow[];
  ignoredRows: DecisionRow[];
  archiveRows: DecisionRow[];
  redirectRows: DecisionRow[];
  unmatchedRows: DecisionRow[];
  lowScoreRows: DecisionRow[];
  tables: TableArtifact[];
}

export interface ArchiveExecutionResultRow extends Record<string, unknown> {
  handle: string;
  title: string;
  productId: string;
  sourcePath: string;
  result: string;
  message: string;
}

export interface RedirectExecutionResultRow extends Record<string, unknown> {
  sourcePath: string;
  targetPath: string;
  targetHandle: string;
  result: string;
  action: string;
  redirectId: string;
  message: string;
}

export interface ExecutionSummary {
  archiveSuccessCount: number;
  archiveFailureCount: number;
  redirectCreateCount: number;
  redirectUpdateCount: number;
  redirectNoopCount: number;
  redirectFailureCount: number;
}

export interface ExecutionResult {
  summary: ExecutionSummary;
  archiveResults: ArchiveExecutionResultRow[];
  redirectResults: RedirectExecutionResultRow[];
  tables: TableArtifact[];
}
