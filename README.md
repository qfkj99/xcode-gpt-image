# GPT Image Workbench

独立图片生成工作台，参考 `basketikun/infinite-canvas` 的生图工作台功能重构。

## 功能

- 左侧生成记录
- 中间提示词、参考图、生成参数
- 右侧生成结果网格
- 支持文生图 `/images/generations`
- 支持参考图编辑 `/images/edits`
- Base URL 自动拼接 OpenAI 兼容路径 `/v1`
- 支持质量、宽高比、自定义分辨率、生成张数
- 图片 Blob 存入 IndexedDB，历史记录元数据存入 localStorage
- API Key 保存在当前浏览器本地
- Docker + Nginx 静态部署

## 本地开发

```bash
npm install
npm run dev
```

访问：

```text
http://localhost:5173
```

## 构建

```bash
npm run build
```

## Docker

```bash
docker build -t gpt-image .
docker run --rm -p 8080:80 gpt-image
```

访问：

```text
http://localhost:8080
```

## 接口配置

推荐填写：

```text
Base URL: https://xcode.best
API Key: sk-your-api-key
Model: gpt-image-2
```

应用会请求：

```text
POST {Base URL}/v1/images/generations
POST {Base URL}/v1/images/edits
```

如果 Base URL 已经以 `/v1`、`/api/v3` 或 `/api/plan/v3` 结尾，则不会重复追加 `/v1`。

## 通过链接导入配置

支持通过 URL 参数导入 API Key 和 Base URL，便于从 NewAPI 后台跳转打开：

```text
https://canvas.best?apiKey={key}&baseUrl={address}
```

也支持同时指定模型：

```text
https://canvas.best?apiKey={key}&baseUrl={address}&model=gpt-image-2
```

导入成功后，应用会保存到当前浏览器本地，并自动从地址栏移除 `apiKey`、`baseUrl` 等参数，减少敏感信息暴露。
