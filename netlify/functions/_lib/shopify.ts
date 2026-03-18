interface AuthInput {
  shopDomain?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
}

interface ShopifyGraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export function resolveShopifyConfig(input: AuthInput): ShopifyConfig {
  const shopDomain = sanitizeShopDomain(input.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN || "");
  const accessToken = (input.accessToken || process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  const apiVersion = (process.env.SHOPIFY_API_VERSION || "2026-01").trim();

  if (!shopDomain) {
    throw new Error("缺少 shop_domain，或 Netlify 环境变量 SHOPIFY_SHOP_DOMAIN 未配置。");
  }

  if (!accessToken) {
    throw new Error(
      "缺少 Shopify Admin access token。MVP 当前需要 access_token，尚未接 client_id/client_secret 动态换 token。",
    );
  }

  return {
    shopDomain,
    accessToken,
    apiVersion,
  };
}

export async function shopifyGraphql<T>(
  config: ShopifyConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const payload = (await response.json()) as ShopifyGraphqlResponse<T>;

  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || `Shopify 请求失败：${response.status}`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message || "Unknown GraphQL error").join("; "));
  }

  if (!payload.data) {
    throw new Error("Shopify GraphQL 返回空数据。");
  }

  return payload.data;
}

export function sanitizeShopDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
}

export function escapeSearchTerm(value: string): string {
  return value.replaceAll(/["\\]/g, "").trim();
}

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePath(value: string): string {
  if (!value.trim()) {
    return "";
  }

  return value.startsWith("/") ? value.trim() : `/${value.trim()}`;
}

export function formatUserErrors(
  errors: Array<{ field?: string[] | null; message?: string | null }> | undefined,
): string {
  if (!errors?.length) {
    return "";
  }

  return errors.map((error) => error.message || "Unknown user error").join("; ");
}
