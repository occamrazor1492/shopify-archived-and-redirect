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

## 适用范围与安装方式

这个项目当前是一个部署在 Netlify 上的外部操作台，不是已经完成 Shopify 内嵌安装流的公共应用。

这点要区分清楚：

- 现在部署到 Netlify 的，是我们自己的前后端工具站点
- 它不会因为上线到 Netlify，就自动变成“商家点一下就能安装”的 Shopify App
- 要让它对某个店铺生效，仍然必须先让这个店铺里存在一个可用的 Shopify app，并给它授权相应 scopes

按当前 MVP 的实现，最现实的使用方式是：

- 目标店铺先准备好 Shopify Admin API 凭证
- 我们把 `shop_domain + access_token` 配到本工具里
- 然后由这个工具代调用 Shopify Admin GraphQL

所以当前版本更适合：

- 你自己的店铺
- 你有管理员权限或受托管理、能合法获取 API 凭证的店铺

当前版本不适合：

- 直接发给任意外部商家自行安装
- 当成 Shopify App Store 公共应用来分发
- 在没有 OAuth 安装流的情况下做多商家自助接入

如果后面要做成“外部商家点击安装即可使用”的正式 Shopify app，需要补以下能力：

- 在 Dev Dashboard / Partner 体系下创建正式 app
- 选择正确的 distribution 方式
- 实现 OAuth 安装与授权
- 为每个店铺安全管理 token，而不是手工贴 `access_token`

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
- `client_id / client_secret` 输入框已保留，但还没有实现 Shopify 官方的动态取 token 流程
- 重定向目标匹配基于导出商品标题与 handle 做相似度计算，低于阈值的记录会进入待复核表
- 目前不是嵌入式 Shopify Admin app，也没有 App Bridge、OAuth callback、安装回调等正式 app 能力
