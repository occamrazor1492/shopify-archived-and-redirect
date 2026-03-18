# Shopify 下架与重定向 App 输入输出定义

## 1. App 目标

这个 App 的目标是把“采集失败商品”自动分流成三类结果：

1. 只归档
2. 归档并重定向
3. 只重定向

同时保留完整的分析表、执行表、执行结果表，方便人工复核和追踪。


## 2. App 的核心输入

App 的输入分成 4 类：

### 2.1 文件输入

这是业务分析的原始输入。

#### A. 失败 SKU 文件

用途：
- 告诉系统哪些商品采集失败，需要进入后续处理

建议字段：
- `主sku编号`
- `失败链接`
- `唯一ID`
- `来源文件`

最少必填：
- `主sku编号`


#### B. 商品导出文件

用途：
- 提供商品命名、handle、变体 SKU、库存
- 用于把失败 SKU 映射到商品

支持：
- `products_export_1.csv`
- `products_export_2.csv`
- `products_export_3.csv`
- `products_export_4.csv`
- 以后也可以扩成任意多个导出文件

建议字段：
- `Handle`
- `Title`
- `Status`
- `Published`
- `Variant SKU`
- `Variant Inventory Qty`

最少必填：
- `Handle`
- `Title`
- `Variant SKU`


### 2.2 Shopify 连接输入

这是 App 能连上 Shopify 的前提配置。

这类输入不是“每次分析都变”的业务数据，而是“系统接入配置”。

至少要支持以下几项：

- `shop_domain`
  - 例如：`your-store.myshopify.com`

- `client_id`

- `client_secret`

- `access_token`
  - 如果 App 采用 `client_credentials` 动态换 token
  - 那么用户未必需要手工输入长期 token
  - 但系统内部运行时一定会拿到一个 `access_token`

也就是说，严格来讲：

- `client_id / client_secret / shop_domain`
  - 是 App 的连接输入

- `access_token`
  - 是运行时认证输入

如果你这个 App 是给自己店铺内部使用，建议页面上支持两种模式：

#### 模式 A：输入 `client_id + client_secret + shop_domain`

系统自动去换 `access_token`

优点：
- 不用每次手工贴 token

#### 模式 B：直接输入 `access_token`

优点：
- 调试更快

所以从 App 设计角度，凭证输入也必须算输入的一部分。


### 2.3 Shopify 实时输入

这是 App 运行时从 Shopify API 拉取的输入。

用于补齐导出表里没有的实时字段。

建议读取字段：
- `product.id`
- `product.handle`
- `product.title`
- `product.status`
- `product.createdAt`
- `product.publishedAt`

本次这套业务里，真正用于决策的是：
- `status`
- `createdAt`


### 2.4 规则输入

这是用户在 App 后台设置的业务参数。

建议作为表单输入：

- `天数阈值`
  - 默认 `60`
  - 含义：只处理 `createdAt` 在最近 60 天之外的商品

- `库存阈值`
  - 默认 `-5`
  - 含义：`<= -5` 视为“卖得多，需要重定向”

- `final sale 排除关键词`
  - 默认：
    - `final sale`
    - `final-sale`
  - 含义：标题包含这些词的商品一律不处理

- `重定向匹配阈值`
  - 第一轮建议默认 `0.62`
  - 如果用户勾选“放宽标准”，可以降到更低，或者直接采用 `候选1`

- `是否自动执行`
  - `false`：只生成分析表
  - `true`：直接归档和写入重定向


## 3. App 的处理逻辑

### 第一步：失败 SKU 合并

输入：
- 失败 SKU 文件
- 多个 `products_export` 文件

处理：
- 合并所有导出文件
- 按 `主sku编号` 和 `Variant SKU` 建立映射
- 找出失败 SKU 对应的商品标题、handle、库存、状态

输出：
- `失败 SKU 命名汇总表`


### 第二步：库存分流

处理：
- 统计每个失败 SKU 的库存
- 按库存阈值拆成两类

规则：
- `库存 <= -5`
- `库存 > -5`

输出：
- `库存<=-5筛选表`
- `剔除库存<=-5后剩余表`


### 第三步：Shopify 实时补齐

处理：
- 根据 SKU 或 handle 去 Shopify 拉实时商品信息
- 补齐 `product_id / status / createdAt / publishedAt`

输出：
- `Shopify 商品明细表`


### 第四步：规则判断

当前确认过的业务规则是：

#### 排除规则

- 标题含 `final sale / final-sale`
- 一律不动

#### 动作规则

- `库存 > -5` 且 `active` 且 `createdAt` 在 60 天外
  - 只改成 `archived`

- `库存 > -5` 且已经 `archived`
  - 不处理

- `库存 <= -5` 且 `active` 且 `createdAt` 在 60 天外
  - 改成 `archived`
  - 必须做重定向

- `库存 <= -5` 且 `archived` 且 `createdAt` 在 60 天外
  - 只做重定向

输出：
- `归档执行表`
- `重定向执行表`
- `忽略表`


### 第五步：重定向目标匹配

目标池来源：
- Shopify 当前 `active` 商品

目标池排除：
- 后续本身也要被归档的商品
- `final sale` 商品

匹配信号：
- `source_title`
- `source_handle`
- `target_title`
- `target_handle`
- 关键词重合
- 类目词
- 相似度分数

第一轮输出：
- `自动匹配表`
- `未匹配表`

第二轮可选：
- 降低阈值
- 直接采用 `候选1`
- 少量商品人工指定目标

输出：
- `重定向导入表`
- `补充重定向导入表`


### 第六步：执行

#### A. 归档执行

输入：
- `归档执行表`

动作：
- 调 Shopify `productUpdate`
- 把 `status` 改成 `ARCHIVED`

输出：
- `归档执行结果表`
- `归档执行汇总`


#### B. 重定向执行

输入：
- `重定向导入表`
- `补充重定向导入表`

动作：
- 先查当前 path 是否已有重定向
- 没有就 `urlRedirectCreate`
- 有但目标不同就 `urlRedirectUpdate`
- 有且目标相同就记为“已存在无需更新”

输出：
- `重定向执行结果表`
- `重定向执行汇总`


## 4. App 的核心输出

App 至少应该输出这 8 类结果：

### 4.1 分析输出

- `失败 SKU 命名汇总表`
- `库存分流表`
- `Shopify 商品明细表`
- `规则排除表`

### 4.2 决策输出

- `归档执行表`
- `重定向执行表`
- `未匹配表`
- `低分待复核表`

### 4.3 执行输出

- `归档执行结果表`
- `重定向执行结果表`
- `总汇总`


## 5. 建议的页面输入

如果这个 App 做成后台页面，建议用户看到的输入只有这些：

### 页面 1：上传与配置

输入项：
- 店铺域名 `shop_domain`
- `client_id`
- `client_secret`
- 或直接填 `access_token`
- 上传失败 SKU 文件
- 上传多个 `products_export` 文件
- 设置天数阈值
- 设置库存阈值
- 设置 `final sale` 排除词
- 选择：
  - 只分析
  - 分析并执行


### 页面 2：分析结果

显示：
- 失败 SKU 总数
- `库存<=-5` 数量
- 可归档数量
- 可重定向数量
- 未匹配数量

下载按钮：
- 下载归档执行表
- 下载重定向执行表
- 下载未匹配表


### 页面 3：执行结果

显示：
- 归档成功数
- 归档失败数
- 重定向创建数
- 重定向更新数
- 已存在无需更新数
- 重定向失败数

下载按钮：
- 下载归档执行结果
- 下载重定向执行结果
- 下载总汇总


## 6. 建议的 API 输入输出

如果这个 App 要拆成后端 API，建议最少有这 3 个接口。

### `POST /api/analyze`

输入：
- 失败 SKU 文件
- 商品导出文件数组
- 配置参数

输出：
- `job_id`
- 分析汇总
- 归档执行表下载地址
- 重定向执行表下载地址
- 未匹配表下载地址


### `POST /api/execute/archive`

输入：
- `job_id`
- 或者直接传 `归档执行表`

输出：
- 成功数
- 失败数
- 结果表下载地址


### `POST /api/execute/redirect`

输入：
- `job_id`
- 或者直接传 `重定向导入表`

输出：
- 创建数
- 更新数
- 已存在数
- 失败数
- 结果表下载地址


## 7. 本次业务最重要的输入和输出

如果你现在先做 MVP，可以只保留最小集合。

### 最小输入

- Shopify 连接信息
  - `shop_domain`
  - `client_id + client_secret`
  - 或 `access_token`
- `失败 SKU 文件`
- `products_export` 文件集合
- `天数阈值`
- `库存阈值`

### 最小输出

- `归档执行表`
- `重定向导入表`
- `未匹配表`
- `归档执行结果`
- `重定向执行结果`


## 8. 一句话总结

这个 App 的本质是：

输入“失败 SKU + 商品导出 + Shopify 实时数据 + 业务规则”，输出“归档清单 + 重定向清单 + 未匹配清单 + 最终执行结果”。
