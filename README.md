# Shopify 下架与重定向助手

一个适合部署到 Netlify 的 Shopify 内部工具，用来处理“采集失败商品”的下架与重定向流程。

## 当前 MVP 能力

- 上传 1 个失败 SKU 文件，支持 `.xls` / `.xlsx` / `.csv`
- 上传多个 `products_export` 文件
- 合并 SKU 与商品导出数据
- 根据库存、创建时间、`final sale` 关键词做规则分流
- 自动生成：
  - `失败 SKU 命名汇总表`
  - `库存分流表`
  - `Shopify 商品明细表`
  - `归档执行表`
  - `重定向执行表`
  - `未匹配表`
  - `低分待复核表`
  - `规则排除表`
- 通过 Netlify Functions 调 Shopify Admin GraphQL：
  - 查询商品实时状态
  - 执行商品归档
  - 创建/更新 URL Redirect

## 技术结构

- 前端：Vite + React + TypeScript
- 文件解析：`xlsx`
- 部署：Netlify 静态站点 + Netlify Functions

## 本地启动

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## Netlify 部署

仓库直接上传到 Netlify 即可，项目已经包含：

- [`netlify.toml`](/Users/zhongziyun/Desktop/archiev_redirect/netlify.toml)
- 构建命令：`npm run build`
- 发布目录：`dist`
- Functions 目录：`netlify/functions`

### 推荐环境变量

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`

默认 API 版本为 `2026-01`。

如果环境变量已经配置，前端页面里的 `shop_domain` 和 `access_token` 可以留空。

## Shopify 权限

至少需要以下 Admin API scopes：

- `read_products`
- `write_products`
- `read_online_store_navigation`
- `write_online_store_navigation`

## 已知范围

- 当前 MVP 以 `shop_domain + access_token` 为主
- `client_id / client_secret` 输入框已保留，但还没有实现动态换 token
- 重定向目标匹配基于导出商品标题与 handle 做相似度计算，低于阈值的记录会进入待复核表
