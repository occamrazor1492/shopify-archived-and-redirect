import { json, parseJsonBody, toErrorMessage } from "./_lib/http";
import {
  escapeSearchTerm,
  normalizeHandle,
  resolveShopifyConfig,
  shopifyGraphql,
} from "./_lib/shopify";

interface CatalogRequestBody {
  shopDomain?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  handles?: string[];
}

interface ProductNode {
  id: string;
  handle: string;
  title: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
}

interface ProductsQueryResponse {
  products: {
    nodes: ProductNode[];
  };
}

const PRODUCTS_BY_HANDLE_QUERY = `
  query ProductsByHandle($query: String!) {
    products(first: 100, query: $query) {
      nodes {
        id
        handle
        title
        status
        createdAt
        publishedAt
      }
    }
  }
`;

export async function handler(event: { body: string | null }) {
  try {
    const body = parseJsonBody<CatalogRequestBody>(event);
    const config = resolveShopifyConfig(body);
    const handles = [...new Set((body.handles || []).map((handle) => handle.trim()).filter(Boolean))];
    const products: Record<string, ProductNode> = {};

    for (const chunk of chunkArray(handles, 20)) {
      const search = chunk.map((handle) => `handle:${escapeSearchTerm(handle)}`).join(" OR ");
      const data = await shopifyGraphql<ProductsQueryResponse>(config, PRODUCTS_BY_HANDLE_QUERY, {
        query: search,
      });

      for (const product of data.products.nodes) {
        const handleKey = normalizeHandle(product.handle);

        if (chunk.some((handle) => normalizeHandle(handle) === handleKey)) {
          products[handleKey] = product;
        }
      }
    }

    return json(200, {
      products: Object.fromEntries(
        Object.entries(products).map(([handleKey, product]) => [
          handleKey,
          {
            productId: product.id,
            handle: product.handle,
            title: product.title,
            status: product.status,
            createdAt: product.createdAt,
            publishedAt: product.publishedAt ?? "",
          },
        ]),
      ),
      meta: {
        requestedCount: handles.length,
        foundCount: Object.keys(products).length,
      },
    });
  } catch (error) {
    return json(400, {
      error: toErrorMessage(error),
    });
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
