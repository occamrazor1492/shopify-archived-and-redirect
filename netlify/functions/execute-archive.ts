import { json, parseJsonBody, toErrorMessage } from "./_lib/http";
import { formatUserErrors, resolveShopifyConfig, shopifyGraphql } from "./_lib/shopify";

interface ArchiveRequestBody {
  shopDomain?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  rows?: Array<{
    handle?: string;
    sourceTitle?: string;
    productId?: string;
    sourcePath?: string;
  }>;
}

interface ProductUpdateResponse {
  productUpdate: {
    product: {
      id: string;
      handle: string;
      title: string;
      status: string;
    } | null;
    userErrors: Array<{ field?: string[] | null; message?: string | null }>;
  };
}

const PRODUCT_ARCHIVE_MUTATION = `
  mutation ArchiveProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        handle
        title
        status
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
    const body = parseJsonBody<ArchiveRequestBody>(event);
    const config = resolveShopifyConfig(body);
    const rows = body.rows || [];
    const results: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let failureCount = 0;

    for (const row of rows) {
      if (!row.productId) {
        failureCount += 1;
        results.push({
          handle: row.handle || "",
          title: row.sourceTitle || "",
          productId: "",
          sourcePath: row.sourcePath || "",
          result: "failed",
          message: "缺少 productId，无法归档。",
        });
        continue;
      }

      try {
        const data = await shopifyGraphql<ProductUpdateResponse>(config, PRODUCT_ARCHIVE_MUTATION, {
          product: {
            id: row.productId,
            status: "ARCHIVED",
          },
        });
        const userErrors = formatUserErrors(data.productUpdate.userErrors);

        if (userErrors) {
          failureCount += 1;
          results.push({
            handle: row.handle || data.productUpdate.product?.handle || "",
            title: row.sourceTitle || data.productUpdate.product?.title || "",
            productId: row.productId,
            sourcePath: row.sourcePath || "",
            result: "failed",
            message: userErrors,
          });
          continue;
        }

        successCount += 1;
        results.push({
          handle: row.handle || data.productUpdate.product?.handle || "",
          title: row.sourceTitle || data.productUpdate.product?.title || "",
          productId: row.productId,
          sourcePath: row.sourcePath || "",
          result: "success",
          message: "已归档。",
        });
      } catch (error) {
        failureCount += 1;
        results.push({
          handle: row.handle || "",
          title: row.sourceTitle || "",
          productId: row.productId,
          sourcePath: row.sourcePath || "",
          result: "failed",
          message: toErrorMessage(error),
        });
      }
    }

    return json(200, {
      results,
      summary: {
        successCount,
        failureCount,
      },
    });
  } catch (error) {
    return json(400, {
      error: toErrorMessage(error),
    });
  }
}
