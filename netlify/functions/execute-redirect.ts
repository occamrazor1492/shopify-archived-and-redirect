import { json, parseJsonBody, toErrorMessage } from "./_lib/http";
import {
  formatUserErrors,
  normalizePath,
  resolveShopifyConfig,
  shopifyGraphql,
} from "./_lib/shopify";

interface RedirectRow {
  sourcePath?: string;
  targetPath?: string;
  targetHandle?: string;
}

interface RedirectRequestBody {
  shopDomain?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  rows?: RedirectRow[];
}

interface UrlRedirectNode {
  id: string;
  path: string;
  target: string;
}

interface RedirectLookupResponse {
  urlRedirects: {
    nodes: UrlRedirectNode[];
  };
}

interface RedirectMutationResponse {
  urlRedirectCreate?: {
    urlRedirect: UrlRedirectNode | null;
    userErrors: Array<{ field?: string[] | null; message?: string | null }>;
  };
  urlRedirectUpdate?: {
    urlRedirect: UrlRedirectNode | null;
    userErrors: Array<{ field?: string[] | null; message?: string | null }>;
  };
}

const URL_REDIRECT_LOOKUP_QUERY = `
  query RedirectByPath($query: String!) {
    urlRedirects(first: 5, query: $query) {
      nodes {
        id
        path
        target
      }
    }
  }
`;

const URL_REDIRECT_CREATE_MUTATION = `
  mutation CreateUrlRedirect($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const URL_REDIRECT_UPDATE_MUTATION = `
  mutation UpdateUrlRedirect($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function handler(event: { body: string | null }) {
  try {
    const body = parseJsonBody<RedirectRequestBody>(event);
    const config = resolveShopifyConfig(body);
    const rows = body.rows || [];
    const results: Array<Record<string, unknown>> = [];
    let createCount = 0;
    let updateCount = 0;
    let noopCount = 0;
    let failureCount = 0;

    for (const row of rows) {
      const sourcePath = normalizePath(row.sourcePath || "");
      const targetPath = normalizePath(row.targetPath || "");

      if (!sourcePath || !targetPath) {
        failureCount += 1;
        results.push({
          sourcePath,
          targetPath,
          targetHandle: row.targetHandle || "",
          result: "failed",
          action: "skipped",
          redirectId: "",
          message: "缺少 sourcePath 或 targetPath。",
        });
        continue;
      }

      try {
        const lookup = await shopifyGraphql<RedirectLookupResponse>(config, URL_REDIRECT_LOOKUP_QUERY, {
          query: `path:'${sourcePath}'`,
        });
        const current = lookup.urlRedirects.nodes.find(
          (item) => normalizePath(item.path) === sourcePath,
        );

        if (!current) {
          const created = await shopifyGraphql<RedirectMutationResponse>(
            config,
            URL_REDIRECT_CREATE_MUTATION,
            {
              urlRedirect: {
                path: sourcePath,
                target: targetPath,
              },
            },
          );
          const userErrors = formatUserErrors(created.urlRedirectCreate?.userErrors);

          if (userErrors) {
            failureCount += 1;
            results.push({
              sourcePath,
              targetPath,
              targetHandle: row.targetHandle || "",
              result: "failed",
              action: "create",
              redirectId: "",
              message: userErrors,
            });
            continue;
          }

          createCount += 1;
          results.push({
            sourcePath,
            targetPath,
            targetHandle: row.targetHandle || "",
            result: "success",
            action: "create",
            redirectId: created.urlRedirectCreate?.urlRedirect?.id || "",
            message: "已创建重定向。",
          });
          continue;
        }

        if (normalizePath(current.target) === targetPath) {
          noopCount += 1;
          results.push({
            sourcePath,
            targetPath,
            targetHandle: row.targetHandle || "",
            result: "noop",
            action: "exists",
            redirectId: current.id,
            message: "已存在相同重定向，无需更新。",
          });
          continue;
        }

        const updated = await shopifyGraphql<RedirectMutationResponse>(
          config,
          URL_REDIRECT_UPDATE_MUTATION,
          {
            id: current.id,
            urlRedirect: {
              path: sourcePath,
              target: targetPath,
            },
          },
        );
        const userErrors = formatUserErrors(updated.urlRedirectUpdate?.userErrors);

        if (userErrors) {
          failureCount += 1;
          results.push({
            sourcePath,
            targetPath,
            targetHandle: row.targetHandle || "",
            result: "failed",
            action: "update",
            redirectId: current.id,
            message: userErrors,
          });
          continue;
        }

        updateCount += 1;
        results.push({
          sourcePath,
          targetPath,
          targetHandle: row.targetHandle || "",
          result: "success",
          action: "update",
          redirectId: updated.urlRedirectUpdate?.urlRedirect?.id || current.id,
          message: "已更新现有重定向。",
        });
      } catch (error) {
        failureCount += 1;
        results.push({
          sourcePath,
          targetPath,
          targetHandle: row.targetHandle || "",
          result: "failed",
          action: "error",
          redirectId: "",
          message: toErrorMessage(error),
        });
      }
    }

    return json(200, {
      results,
      summary: {
        createCount,
        updateCount,
        noopCount,
        failureCount,
      },
    });
  } catch (error) {
    return json(400, {
      error: toErrorMessage(error),
    });
  }
}
