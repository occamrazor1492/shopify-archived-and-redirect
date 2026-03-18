import { startTransition, useState } from "react";

import { analyzeData } from "./lib/analyze";
import { downloadCsv } from "./lib/csv";
import { parseFailedSkuFile, parseProductExportFiles } from "./lib/parse";
import type {
  AnalysisResult,
  AnalysisRules,
  ArchiveExecutionResultRow,
  ExecutionResult,
  RedirectExecutionResultRow,
  ShopifyCredentials,
  ShopifyProductDetail,
  TableArtifact,
} from "./lib/types";

const DEFAULT_RULES: AnalysisRules = {
  daysThreshold: 60,
  inventoryThreshold: -5,
  redirectThreshold: 0.62,
  finalSaleKeywords: ["final sale", "final-sale"],
  autoExecute: false,
};

const DEFAULT_CREDENTIALS: ShopifyCredentials = {
  shopDomain: "",
  accessToken: "",
  clientId: "",
  clientSecret: "",
};

interface ShopifyLookupResponse {
  products: Record<string, ShopifyProductDetail>;
  meta: {
    requestedCount: number;
    foundCount: number;
  };
}

interface ArchiveFunctionResponse {
  results: ArchiveExecutionResultRow[];
  summary: {
    successCount: number;
    failureCount: number;
  };
}

interface RedirectFunctionResponse {
  results: RedirectExecutionResultRow[];
  summary: {
    createCount: number;
    updateCount: number;
    noopCount: number;
    failureCount: number;
  };
}

export default function App() {
  const [credentials, setCredentials] = useState<ShopifyCredentials>(DEFAULT_CREDENTIALS);
  const [rules, setRules] = useState<AnalysisRules>(DEFAULT_RULES);
  const [failureFile, setFailureFile] = useState<File | null>(null);
  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");

  async function runAnalysis() {
    if (!failureFile) {
      setError("请先上传失败 SKU 文件。");
      return;
    }

    if (!productFiles.length) {
      setError("请至少上传一个 products_export 文件。");
      return;
    }

    setBusy(true);
    setBusyLabel("正在解析上传文件...");
    setError("");
    setExecution(null);

    try {
      const [failures, productRows] = await Promise.all([
        parseFailedSkuFile(failureFile),
        parseProductExportFiles(productFiles),
      ]);
      const handles = [...new Set(productRows.map((row) => row.handle.trim()).filter(Boolean))];

      let shopifyProducts: Record<string, ShopifyProductDetail> = {};
      let liveLookupEnabled = false;
      let lookupWarning = "";

      if (handles.length) {
        setBusyLabel("正在向 Shopify 拉取实时状态...");

        try {
          const lookup = await postFunction<ShopifyLookupResponse>("/.netlify/functions/shopify-catalog", {
            shopDomain: credentials.shopDomain,
            accessToken: credentials.accessToken,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            handles,
          });

          shopifyProducts = lookup.products;
          liveLookupEnabled = true;
        } catch (lookupError) {
          lookupWarning =
            lookupError instanceof Error
              ? lookupError.message
              : "Shopify 实时查询失败，已回退到导出文件分析。";
        }
      }

      setBusyLabel("正在生成归档与重定向分析表...");
      const result = analyzeData({
        failures,
        productRows,
        shopifyDetails: shopifyProducts,
        rules,
        liveLookupEnabled,
      });

      if (lookupWarning) {
        result.warnings.unshift(`Shopify 实时查询未完成：${lookupWarning}`);
      }

      startTransition(() => {
        setAnalysis(result);
      });

      if (rules.autoExecute) {
        await runExecution(result);
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "分析失败，请检查输入文件。");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function runExecution(result = analysis) {
    if (!result) {
      setError("请先完成分析。");
      return;
    }

    setBusy(true);
    setBusyLabel("正在执行 Shopify 归档与重定向...");
    setError("");

    try {
      const archivePromise = result.archiveRows.length
        ? postFunction<ArchiveFunctionResponse>("/.netlify/functions/execute-archive", {
            shopDomain: credentials.shopDomain,
            accessToken: credentials.accessToken,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            rows: result.archiveRows,
          })
        : Promise.resolve({
            results: [] as ArchiveExecutionResultRow[],
            summary: {
              successCount: 0,
              failureCount: 0,
            },
          });

      const redirectPromise = result.redirectRows.length
        ? postFunction<RedirectFunctionResponse>("/.netlify/functions/execute-redirect", {
            shopDomain: credentials.shopDomain,
            accessToken: credentials.accessToken,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            rows: result.redirectRows,
          })
        : Promise.resolve({
            results: [] as RedirectExecutionResultRow[],
            summary: {
              createCount: 0,
              updateCount: 0,
              noopCount: 0,
              failureCount: 0,
            },
          });

      const [archiveResponse, redirectResponse] = await Promise.all([
        archivePromise,
        redirectPromise,
      ]);

      setExecution({
        summary: {
          archiveSuccessCount: archiveResponse.summary.successCount,
          archiveFailureCount: archiveResponse.summary.failureCount,
          redirectCreateCount: redirectResponse.summary.createCount,
          redirectUpdateCount: redirectResponse.summary.updateCount,
          redirectNoopCount: redirectResponse.summary.noopCount,
          redirectFailureCount: redirectResponse.summary.failureCount,
        },
        archiveResults: archiveResponse.results,
        redirectResults: redirectResponse.results,
        tables: [
          makeTable("archive-results", "归档执行结果表", "archive-results.csv", archiveResponse.results),
          makeTable(
            "redirect-results",
            "重定向执行结果表",
            "redirect-results.csv",
            redirectResponse.results,
          ),
          makeTable(
            "execution-summary",
            "总汇总",
            "execution-summary.csv",
            [
              {
                archiveSuccessCount: archiveResponse.summary.successCount,
                archiveFailureCount: archiveResponse.summary.failureCount,
                redirectCreateCount: redirectResponse.summary.createCount,
                redirectUpdateCount: redirectResponse.summary.updateCount,
                redirectNoopCount: redirectResponse.summary.noopCount,
                redirectFailureCount: redirectResponse.summary.failureCount,
              },
            ],
          ),
        ],
      });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "执行失败，请检查 Shopify 凭证。");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Netlify MVP</span>
          <h1>Shopify 下架与重定向助手</h1>
          <p>
            上传失败 SKU 文件与多个 `products_export`，自动生成归档表、重定向表、未匹配表，
            并可直接通过 Netlify Functions 执行到 Shopify。
          </p>
        </div>

        <div className="hero-panel">
          <div className="hero-stat">
            <strong>{analysis?.summary.failedSkuCount ?? 0}</strong>
            <span>失败 SKU</span>
          </div>
          <div className="hero-stat">
            <strong>{analysis?.summary.archiveReadyCount ?? 0}</strong>
            <span>可归档</span>
          </div>
          <div className="hero-stat">
            <strong>{analysis?.summary.redirectReadyCount ?? 0}</strong>
            <span>可重定向</span>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <div className="section-title">
            <h2>页面 1：上传与配置</h2>
            <p>前端负责解析文件，Shopify 实时查询与执行走 Netlify Functions。</p>
          </div>

          <div className="grid two">
            <label className="field">
              <span>店铺域名</span>
              <input
                value={credentials.shopDomain}
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    shopDomain: event.target.value,
                  }))
                }
                placeholder="your-store.myshopify.com"
              />
            </label>

            <label className="field">
              <span>Admin API Access Token</span>
              <input
                value={credentials.accessToken}
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    accessToken: event.target.value,
                  }))
                }
                placeholder="shpat_xxx"
                type="password"
              />
            </label>

            <label className="field">
              <span>client_id</span>
              <input
                value={credentials.clientId}
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    clientId: event.target.value,
                  }))
                }
                placeholder="预留字段"
              />
            </label>

            <label className="field">
              <span>client_secret</span>
              <input
                value={credentials.clientSecret}
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    clientSecret: event.target.value,
                  }))
                }
                placeholder="预留字段"
                type="password"
              />
            </label>
          </div>

          <p className="hint">
            当前版本是部署在 Netlify 上的外部运营工具，不是已经做成可给任意商家安装的 Shopify 公共应用。
            现在必须先在目标店铺对应的 Shopify app 上拿到凭证，再把 `shop_domain + access_token`
            配进来使用。
          </p>

          <div className="warning-box">
            <p>
              适用范围：更适合你自己有管理员权限的店铺，或你受托管理、能合法拿到 API 凭证的店铺。
            </p>
            <p>
              当前代码还没实现 Shopify OAuth 安装流。`client_id / client_secret` 字段是为下一阶段预留的；
              如果后面要给外部商家自行安装，就必须补正式的 OAuth / distribution 方案。
            </p>
          </div>

          <div className="grid two upload-grid">
            <label className="upload">
              <span>失败 SKU 文件</span>
              <input
                type="file"
                accept=".xls,.xlsx,.csv"
                onChange={(event) => setFailureFile(event.target.files?.[0] ?? null)}
              />
              <small>{failureFile ? failureFile.name : "支持 xls / xlsx / csv"}</small>
            </label>

            <label className="upload">
              <span>products_export 文件集合</span>
              <input
                type="file"
                accept=".csv,.xls,.xlsx"
                multiple
                onChange={(event) => setProductFiles(Array.from(event.target.files ?? []))}
              />
              <small>
                {productFiles.length
                  ? `已选择 ${productFiles.length} 个文件`
                  : "可一次性上传多个 Shopify 导出文件"}
              </small>
            </label>
          </div>

          <div className="grid four">
            <label className="field">
              <span>天数阈值（默认 60，可改）</span>
              <input
                type="number"
                value={rules.daysThreshold}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    daysThreshold: Number(event.target.value) || 0,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>库存阈值（默认 -5，可改）</span>
              <input
                type="number"
                value={rules.inventoryThreshold}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    inventoryThreshold: Number(event.target.value) || 0,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>重定向阈值（默认 0.62，可改）</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={rules.redirectThreshold}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    redirectThreshold: Number(event.target.value) || 0,
                  }))
                }
              />
            </label>

            <label className="toggle">
              <span>分析并执行</span>
              <input
                type="checkbox"
                checked={rules.autoExecute}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    autoExecute: event.target.checked,
                  }))
                }
              />
            </label>
          </div>

          <label className="field">
            <span>final sale 排除关键词（可改）</span>
            <textarea
              rows={4}
              value={rules.finalSaleKeywords.join("\n")}
              onChange={(event) =>
                setRules((current) => ({
                  ...current,
                  finalSaleKeywords: event.target.value
                    .split(/\n|,/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="每行一个关键词"
            />
          </label>

          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void runAnalysis()}>
              {busy ? "处理中..." : "开始分析"}
            </button>

            {analysis ? (
              <button className="secondary" disabled={busy} onClick={() => void runExecution()}>
                执行归档与重定向
              </button>
            ) : null}
          </div>

          {busyLabel ? <p className="status-line">{busyLabel}</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          {analysis?.warnings.length ? (
            <div className="warning-box">
              {analysis.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </section>

        {analysis ? (
          <section className="card">
            <div className="section-title">
              <h2>页面 2：分析结果</h2>
              <p>摘要、可下载表格、以及关键结果预览。</p>
            </div>

            <div className="stats-grid">
              <Stat label="失败 SKU 总数" value={analysis.summary.failedSkuCount} />
              <Stat label="已映射 SKU" value={analysis.summary.mappedSkuCount} />
              <Stat label="库存<=阈值" value={analysis.summary.inventoryRedirectCandidateCount} />
              <Stat label="可归档数量" value={analysis.summary.archiveReadyCount} />
              <Stat label="可重定向数量" value={analysis.summary.redirectReadyCount} />
              <Stat label="未匹配数量" value={analysis.summary.unmatchedCount} />
              <Stat label="低分待复核" value={analysis.summary.lowScoreCount} />
              <Stat label="规则排除" value={analysis.summary.ignoredCount} />
            </div>

            <div className="rule-summary">
              <div className="section-title">
                <h3>本次分析使用的变量</h3>
                <p>这些值来自你页面里填写的参数，不是写死在执行逻辑里的固定常量。</p>
              </div>
              <div className="stats-grid compact">
                <Stat label="天数阈值" value={analysis.rulesUsed.daysThreshold} />
                <Stat label="库存阈值" value={analysis.rulesUsed.inventoryThreshold} />
                <Stat label="重定向阈值 x100" value={Math.round(analysis.rulesUsed.redirectThreshold * 100)} />
                <TextStat
                  label="final sale 排除词"
                  value={analysis.rulesUsed.finalSaleKeywords.join(" / ") || "无"}
                />
              </div>
            </div>

            <div className="downloads">
              {analysis.tables
                .filter((table) => table.rows.length)
                .map((table) => (
                  <button
                    key={table.key}
                    className="ghost"
                    onClick={() => downloadCsv(table.filename, table.rows)}
                  >
                    下载{table.label}
                  </button>
                ))}
            </div>

            <PreviewTable title="归档执行表预览" rows={analysis.archiveRows} />
            <PreviewTable title="重定向执行表预览" rows={analysis.redirectRows} />
            <PreviewTable title="未匹配表预览" rows={analysis.unmatchedRows} />
            <PreviewTable title="低分待复核预览" rows={analysis.lowScoreRows} />
          </section>
        ) : null}

        {execution ? (
          <section className="card">
            <div className="section-title">
              <h2>页面 3：执行结果</h2>
              <p>归档与重定向执行后的结果汇总。</p>
            </div>

            <div className="stats-grid">
              <Stat label="归档成功数" value={execution.summary.archiveSuccessCount} />
              <Stat label="归档失败数" value={execution.summary.archiveFailureCount} />
              <Stat label="重定向创建数" value={execution.summary.redirectCreateCount} />
              <Stat label="重定向更新数" value={execution.summary.redirectUpdateCount} />
              <Stat label="已存在无需更新数" value={execution.summary.redirectNoopCount} />
              <Stat label="重定向失败数" value={execution.summary.redirectFailureCount} />
            </div>

            <div className="downloads">
              {execution.tables
                .filter((table) => table.rows.length)
                .map((table) => (
                  <button
                    key={table.key}
                    className="ghost"
                    onClick={() => downloadCsv(table.filename, table.rows)}
                  >
                    下载{table.label}
                  </button>
                ))}
            </div>

            <PreviewTable title="归档执行结果预览" rows={execution.archiveResults} />
            <PreviewTable title="重定向执行结果预览" rows={execution.redirectResults} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function TextStat(props: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <strong className="text-strong">{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function PreviewTable(props: {
  title: string;
  rows: Array<Record<string, unknown>>;
}) {
  if (!props.rows.length) {
    return null;
  }

  const previewRows = props.rows.slice(0, 6);
  const headers = Object.keys(previewRows[0] ?? {});

  return (
    <div className="table-card">
      <div className="table-title">
        <h3>{props.title}</h3>
        <span>显示前 {previewRows.length} 行</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, index) => (
              <tr key={String(row.rowId ?? row.handle ?? row.sourcePath ?? `${props.title}-${index}`)}>
                {headers.map((header) => (
                  <td
                    key={`${String(row.rowId ?? row.handle ?? row.sourcePath ?? `${props.title}-${index}`)}:${header}`}
                  >
                    {formatCell(row[header])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return String(value);
}

async function postFunction<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || payload.message || `请求失败：${response.status}`);
  }

  return payload as T;
}

function makeTable(
  key: string,
  label: string,
  filename: string,
  rows: Array<Record<string, unknown>>,
): TableArtifact {
  return { key, label, filename, rows };
}
