# GPT Image Workbench

独立图片生成工作台，参考 `basketikun/infinite-canvas` 的生图工作台功能重构。

## 功能

- 左侧生成记录
- 中间提示词、参考图、生成参数
- 右侧生成结果网格
- 支持文生图 `/images/generations`
- 支持参考图编辑 `/images/edits`
- Base URL 自动拼接 OpenAI 兼容路径 `/v1`
- 支持质量、宽高比、自定义分辨率、生成张数（最多 4 张）
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

## 部署到其他服务器

以下步骤适用于一台已经可以 SSH 登录的 Linux 服务器。

### 1. 安装 Docker

Ubuntu / Debian 示例：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

确认 Docker 可用：

```bash
docker --version
```

### 2. 拉取项目代码

```bash
git clone https://github.com/qfkj99/xcode-gpt-image.git
cd xcode-gpt-image
```

如果服务器没有安装 Git：

```bash
sudo apt install -y git
```

### 3. 构建镜像

```bash
docker build -t gpt-image .
```

### 4. 启动容器

```bash
docker run -d \
  --name gpt-image \
  --restart unless-stopped \
  -p 8080:80 \
  gpt-image
```

访问：

```text
http://服务器IP:8080
```

### 5. 更新部署

进入项目目录：

```bash
cd xcode-gpt-image
git pull
docker build -t gpt-image .
docker stop gpt-image
docker rm gpt-image
docker run -d \
  --name gpt-image \
  --restart unless-stopped \
  -p 8080:80 \
  gpt-image
```

### 6. 查看和停止服务

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker logs -f gpt-image
```

停止服务：

```bash
docker stop gpt-image
docker rm gpt-image
```

### 7. 可选：使用域名和 HTTPS

如果服务器上已有 Nginx / OpenResty / 宝塔 / 1Panel，可以把域名反向代理到：

```text
http://127.0.0.1:8080
```

Nginx 示例：

```nginx
server {
    listen 80;
    server_name canvas.best;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置 HTTPS 后，可以在 NewAPI 后台使用链接导入配置：

```text
https://canvas.best?apiKey={key}&baseUrl={address}&model=gpt-image-2
```

应用会将 `apiKey`、`baseUrl`、`model` 保存到当前浏览器本地，并自动清理地址栏参数。

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
