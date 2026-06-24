# GPT Image 项目需求文档（开发版）

## 0. 当前实现说明

当前项目已根据 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的生图工作台功能重构，首版实现形态以“独立生图工作台”为准，而不是早期的 ChatGPT 对话窗口方案。

当前实现包含：

1. 左侧生成记录。
2. 中间提示词、参考图、生成参数和开始生成按钮。
3. 右侧生成结果网格。
4. 接口配置使用 Base URL、API Key、模型列表和默认生图模型。
5. 文生图请求走 `{Base URL}/v1/images/generations`。
6. 参考图编辑请求走 `{Base URL}/v1/images/edits`。
7. 图片 Blob 使用 IndexedDB 持久化，localStorage 只保存配置和历史元数据。

以下早期章节中关于“对话式窗口”的描述仅作为历史需求背景；后续开发以本节和变更记录中的工作台方案为准。

## 1. 项目背景

本项目旨在构建一个可视化图片生成工具，用户可以在类似 ChatGPT 官网的对话窗口中输入图片生成需求，系统调用兼容图片生成接口生成图片，并在对话流中展示生成结果。

当前目标接口示例：

```bash
curl -X POST "https://xcode.best/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只可爱的小猫咪在花丛中",
    "size": "1024x1024"
  }'
```

其中接口地址 `url`、`apikey` 需要支持用户自定义配置。

## 2. 产品目标

1. 提供一个简洁、易用的图片生成前端界面。
2. 支持配置自定义图片生成接口地址和 API Key。
3. 支持用户以对话方式输入图片描述，并在对话窗口中查看生成状态和生成图片。
4. UI 风格参考 NewAPI 项目，整体应简洁、现代、偏管理后台/工具型界面。
5. 为后续扩展模型、尺寸、图片下载等能力预留空间。

## 3. 目标用户

1. 需要快速调用图片生成接口的个人用户。
2. 需要测试不同图片生成 API 地址、API Key、模型和参数的开发者。
3. 需要一个轻量 Web UI 来封装图片生成能力的团队成员。

## 4. 核心使用场景

### 4.1 首次配置接口

用户进入系统后，可以配置：

1. API Base URL，例如 `https://xcode.best/v1/images/generations`。
2. API Key，例如 `sk-xxxx`。
3. 默认模型，例如 `gpt-image-2`。
4. 默认图片尺寸，例如 `1024x1024`。

配置保存后，用户无需每次生成图片都重复填写。

### 4.2 对话式生成图片

用户在底部输入框输入提示词，例如：

```text
一只可爱的小猫咪在花丛中，柔和阳光，高清摄影风格
```

点击发送后：

1. 用户消息显示在右侧或对话流中。
2. 系统显示生成中状态。
3. 浏览器前端调用图片生成接口。
4. 成功后在系统回复区域展示生成图片。
5. 失败时显示可读的错误信息，并允许用户重试。

### 4.3 调整生成参数

用户可以在界面中调整：

1. 模型名称。
2. 图片大小/分辨率。
3. 可选高级参数，如图片数量、质量、风格等。

首版需要将模型、图片大小/分辨率等生成参数放在底部输入框附近，用户在输入 prompt 时可以直接调整，不需要进入全局设置面板。

### 4.4 查看和管理生成结果

用户生成图片后，可以：

1. 在当前对话中查看图片。
2. 下载图片。
3. 复制图片 URL 或复制提示词。
4. 重新使用同一提示词再次生成。

生成历史记录需要持久化到浏览器 localStorage，刷新页面后仍可查看。

## 5. 功能需求

### 5.1 前端界面

#### 5.1.1 页面整体布局

界面参考 ChatGPT 官网对话窗口：

1. 中央为主要对话区域。
2. 底部固定输入区。
3. 输入区支持多行文本。
4. 发送按钮位于输入框右侧或右下角。
5. 生成中显示加载状态。
6. 图片结果以内嵌卡片形式出现在对话流中。

界面风格参考 NewAPI 项目：

1. 简洁、现代、工具型。
2. 颜色克制，避免过度装饰。
3. 首版仅支持浅色模式，不实现深色模式。
4. 按钮、输入框、弹窗、表单等组件风格统一。

#### 5.1.2 主要页面

初版建议包含以下页面或区域：

1. 图片生成对话页：核心使用页面。
2. 连接设置面板：配置 API URL、API Key。
3. 输入区参数设置：配置 Model、Size 等图片生成参数。
4. 历史记录侧边栏：展示本地持久化的历史生成任务。

#### 5.1.3 对话消息类型

对话流中至少包含：

1. 用户文本消息。
2. 系统生成中消息。
3. 系统图片结果消息。
4. 系统错误消息。

#### 5.1.4 输入区

输入区能力：

1. 输入提示词。
2. Enter 发送，Shift + Enter 换行。
3. 为空时禁止发送。
4. 请求进行中时防止重复提交，或允许排队提交（初版建议防止重复提交）。
5. 支持清空当前输入。
6. 在输入框附近提供生成参数设置入口。
7. 支持直接调整 Model、Size。
8. 当前选择的 Size 需要在输入区可见，避免用户不知道本次生成参数。

### 5.2 配置项

系统需要支持以下配置项，并按使用场景分区展示：

| 字段 | 类型 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- | --- |
| API URL | string | 是 | `https://xcode.best/v1/images/generations` | 图片生成接口完整地址 |
| API Key | string | 是 | `sk-your-api-key` | 鉴权密钥 |
| Model | string | 是 | `gpt-image-2` | 图片生成模型 |
| Size | string | 是 | `1024x1024` | 图片尺寸 |

展示位置：

1. API URL、API Key 放在全局连接设置面板。
2. Model、Size 放在底部输入框附近的参数设置区域。

API Key 需要在界面中默认脱敏展示，编辑时可切换显示/隐藏。

### 5.3 图片生成请求

前端提交生成任务后，系统请求体格式如下：

```json
{
  "model": "gpt-image-2",
  "prompt": "一只可爱的小猫咪在花丛中",
  "size": "1024x1024"
}
```

请求头：

```http
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

### 5.4 图片生成响应

目标接口实际返回示例：

```json
{
  "created": 1782184442,
  "data": [
    {
      "b64_json": "iVBORw0SW3......ErkJggg==",
      "url": "http://152.53.210.78:3000/images/2026/06/23/1782184504_d6fb5d6ac95c059e08f9a9d505f8581e.png",
      "revised_prompt": "一只可爱的小猫咪在花丛中"
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 1650,
    "total_tokens": 1662,
    "input_tokens_details": {
      "text_tokens": 12,
      "image_tokens": 0,
      "cached_tokens": 0
    },
    "output_tokens_details": {
      "text_tokens": 0,
      "image_tokens": 1650,
      "reasoning_tokens": 0
    }
  }
}
```

初版解析规则：

1. 优先使用 `data[].url` 展示图片。
2. 如果 `url` 为空但存在 `b64_json`，使用 base64 数据展示图片。
3. 如果存在 `revised_prompt`，在图片结果中展示或折叠显示修订后的提示词。
4. 如果存在 `usage`，初版可在详情区域展示 token 使用量；若界面空间有限，可先保存在消息数据中，后续展示。
5. 如果 `data` 为空或没有可用图片字段，显示“接口响应格式不符合预期”。

### 5.5 错误处理

需要处理以下错误：

1. API URL 未配置。
2. API Key 未配置。
3. 提示词为空。
4. 接口请求超时。
5. 接口返回 401/403 鉴权失败。
6. 接口返回 429 限流。
7. 接口返回 5xx 服务异常。
8. 响应格式无法解析。

错误信息应尽量对用户可读，例如：

```text
生成失败：API Key 无效或无权限，请检查设置。
```

### 5.6 图片结果操作

图片生成成功后，结果区域提供：

1. 下载图片。
2. 在新窗口打开图片。
3. 复制图片地址。
4. 复制提示词。
5. 重新生成。

初版至少实现展示图片和下载图片。

## 6. 非功能需求

### 6.1 安全

1. API Key 不应硬编码在前端源码中。
2. 初版 API Key 保存在浏览器 localStorage，并由浏览器直接参与外部接口请求。
3. 设置面板需要明确提示：API Key 会保存在当前浏览器本地，请勿在不可信设备上保存。
4. API Key 在界面中默认脱敏展示，并支持显示/隐藏。
5. 后续如需要更高安全性，应增加后端代理、用户系统和服务端密钥管理。

### 6.2 性能

1. 发送请求后界面需立即进入生成中状态。
2. 图片加载期间显示占位状态。
3. 图片加载失败时显示失败提示。
4. 单次请求超时时间建议为 60 到 120 秒，可配置。

### 6.3 可扩展性

后续可扩展：

1. 多模型选择。
2. 多尺寸选择。
3. 多会话管理。
4. 用户登录和多用户隔离。
5. 服务端历史记录同步。
6. 支持更多兼容 OpenAI Images API 的服务商。

## 7. 初版范围

### 7.1 必须实现

1. 对话式图片生成页面。
2. API URL 配置。
3. API Key 配置。
4. Model 配置。
5. Size 配置。
6. 调用图片生成接口。
7. 展示生成图片。
8. 展示生成失败原因。
9. 基础加载状态。
10. 本地持久化历史记录。
11. PC 端布局适配。

### 7.2 建议实现

1. 下载图片。
2. 复制图片地址。
3. 复制提示词。
4. 本地保存配置。

### 7.3 暂不实现

1. 用户登录。
2. 服务端多用户 API Key 管理。
3. 计费系统。
4. 图片编辑。
5. 图片局部重绘。
6. 多轮图像上下文编辑。
7. 多图生成。
8. 深色模式。
9. 移动端专项适配。

## 8. 技术选型

结合当前项目从零开始、需要 Docker 部署、初版 API Key 先保存在浏览器本地的要求，推荐采用轻量前端单页应用方案：

1. 前端框架：React + TypeScript。
2. 构建工具：Vite。
3. 样式方案：Tailwind CSS。
4. 图标：lucide-react。
5. 数据存储：localStorage。
6. 部署方式：Docker + Nginx 静态文件服务。

选择该方案的原因：

1. 项目核心是单页图片生成工具，不需要首屏服务端渲染。
2. Vite 构建快、配置轻，适合当前项目快速落地。
3. React 组件生态成熟，适合实现类 ChatGPT 的对话式交互。
4. Tailwind CSS 便于快速贴近 NewAPI 的简洁后台工具风格。
5. Docker 中使用 Nginx 托管构建产物，部署简单、资源占用低。

后续如果需要服务端保护 API Key、多用户、数据库、额度管理，再增加后端服务或切换为全栈框架。

## 9. 页面交互草图

```text
┌────────────────────────────────────────────────────────────┐
│ 顶部栏：GPT Image                         设置按钮        │
├───────────────┬────────────────────────────────────────────┤
│ 历史记录       │ 对话区域                                   │
│ 可选           │                                            │
│               │ 用户：一只可爱的小猫咪在花丛中              │
│               │                                            │
│               │ 助手：生成中...                             │
│               │                                            │
│               │ 助手：[生成图片预览]                         │
│               │       下载 / 复制地址 / 重新生成             │
│               │                                            │
├───────────────┴────────────────────────────────────────────┤
│ 参数：Model gpt-image-2   Size 1024x1024            设置   │
│ 输入框：描述你想生成的图片...                       发送    │
└────────────────────────────────────────────────────────────┘
```

设置面板：

```text
┌─────────────────────────────┐
│ 设置                         │
├─────────────────────────────┤
│ API URL                      │
│ https://xcode.best/...       │
│                              │
│ API Key                      │
│ sk-*************             │
│                              │
│              取消    保存    │
└─────────────────────────────┘
```

输入区参数设置：

```text
┌─────────────────────────────────────────────┐
│ Model                                       │
│ gpt-image-2                                 │
│                                             │
│ Size / 分辨率                               │
│ 1024x1024                                   │
│                                             │
│                    应用                     │
└─────────────────────────────────────────────┘
```

## 10. 验收标准

1. 用户可以打开页面并看到对话式图片生成界面。
2. 用户可以在连接设置面板配置 API URL、API Key。
3. 用户可以在输入框附近配置 Model、Size。
4. 用户输入提示词后可以发起图片生成请求。
5. 请求成功时，页面能展示接口返回的图片。
6. 请求失败时，页面能显示明确错误信息。
7. 刷新页面后，基础配置仍然保留（若初版选择 localStorage）。
8. UI 整体符合简洁、现代、类 ChatGPT 对话窗口的体验。
9. 项目可以通过 Docker 构建并运行。
10. 刷新页面后，历史生成记录仍然可查看。
11. 首版仅生成单张图片，不提供多图数量选择。
12. 首版在 PC 端浏览器中完成验收。

## 11. 已确认决策

### 11.1 首版决策

1. 技术栈由项目实现方选择，初版确定为 React + TypeScript + Vite + Tailwind CSS。
2. 项目需要支持 Docker 部署。
3. API Key 初版保存在浏览器本地。
4. UI 风格参考 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)。
5. 图片生成接口返回值包含 `data[].b64_json`、`data[].url`、`data[].revised_prompt` 和 `usage`。
6. 首版需要将历史记录持久化到 localStorage。
7. 首版不支持多图生成，每次请求只生成一张图片。
8. 首版不支持深色模式。
9. 首版只做 PC 端适配。
10. API URL 首版直接填写完整生成接口地址，不拆分 Base URL 和 Endpoint。
11. Model、Size 等生成参数放在输入框附近，不放在全局连接设置面板中。

## 12. 系统架构

初版采用“前端单页应用 + 浏览器直连图片生成接口”的架构。

```text
浏览器前端
  │
  │ 1. 用户输入 prompt、model、size
  │ 2. 从 localStorage 读取 API URL 和 API Key
  │ 3. 发起 fetch 请求
  ▼
图片生成服务
  │
  │ 4. 返回图片 URL、base64、revised_prompt、usage
  ▼
浏览器前端
  │
  │ 5. 解析响应并在对话流中展示图片
```

初版采用前端直连的原因：

1. 当前需求要求 API URL 和 API Key 可由用户自定义，并先保存在浏览器本地。
2. 项目核心是轻量图片生成工具，不需要首版引入后端复杂度。
3. 前端静态应用更容易通过 Docker + Nginx 部署。
4. 后续如需保护 API Key，可平滑增加后端代理。

后续增强架构可升级为“前端 + 后端代理接口”，由后端统一管理 API Key、请求转发、响应适配、日志和限流。

## 13. 外部接口调用设计

### 13.1 生成图片接口

浏览器前端直接调用用户配置的 API URL：

```http
POST https://xcode.best/v1/images/generations
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "一只可爱的小猫咪在花丛中",
  "size": "1024x1024"
}
```

响应成功示例：

```json
{
  "created": 1782184442,
  "data": [
    {
      "b64_json": "iVBORw0SW3......ErkJggg==",
      "url": "http://152.53.210.78:3000/images/2026/06/23/1782184504_d6fb5d6ac95c059e08f9a9d505f8581e.png",
      "revised_prompt": "一只可爱的小猫咪在花丛中"
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 1650,
    "total_tokens": 1662
  }
}
```

前端内部应将响应转换为统一消息数据：

```ts
type ImageGenerationResult = {
  created?: number;
  images: GeneratedImage[];
  usage?: ImageUsage;
  raw: unknown;
};
```

### 13.2 前端请求要求

1. 请求方法为 `POST`。
2. 请求头必须包含 `Content-Type: application/json`。
3. 请求头必须包含 `Authorization: Bearer ${apiKey}`。
4. 请求体至少包含 `model`、`prompt`、`size`。
5. 请求超时时间建议默认为 120 秒。
6. 请求期间应支持取消或禁用重复提交，初版建议禁用重复提交。

### 13.3 错误码建议

| 错误码 | 场景 | 用户提示 |
| --- | --- | --- |
| `MISSING_API_URL` | 未配置接口地址 | 请先在设置中填写 API URL。 |
| `MISSING_API_KEY` | 未配置 API Key | 请先在设置中填写 API Key。 |
| `EMPTY_PROMPT` | 提示词为空 | 请输入图片描述。 |
| `UNAUTHORIZED` | 401/403 | API Key 无效或无权限，请检查设置。 |
| `RATE_LIMITED` | 429 | 请求过于频繁，请稍后再试。 |
| `UPSTREAM_ERROR` | 5xx | 图片生成服务暂时不可用，请稍后重试。 |
| `TIMEOUT` | 请求超时 | 图片生成超时，请稍后重试。 |
| `INVALID_RESPONSE` | 响应无法解析 | 接口响应格式不符合预期。 |

## 14. 前端组件拆分建议

### 14.1 页面组件

1. `ImageChatPage`：图片生成主页面。
2. `ChatMessageList`：对话消息列表。
3. `PromptComposer`：底部提示词输入区。
4. `GenerationSettingsBar`：输入区附近的生成参数设置条。
5. `GenerationSettingsPopover`：生成参数展开设置面板。
6. `SettingsPanel`：API URL 和 API Key 连接设置面板。
7. `ImageResultCard`：图片结果卡片。
8. `HistorySidebar`：历史记录侧边栏，首版必须实现。

### 14.2 状态结构

建议前端维护以下状态：

```ts
type AppSettings = {
  apiUrl: string;
  apiKey: string;
};

type GenerationSettings = {
  model: string;
  size: string;
};

type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      status: "loading" | "success" | "error";
      prompt: string;
      images?: GeneratedImage[];
      errorMessage?: string;
      createdAt: string;
    };

type GeneratedImage = {
  type: "url" | "base64";
  url?: string;
  b64_json?: string;
  revisedPrompt?: string;
};

type ImageUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: unknown;
};

type HistoryRecord = {
  id: string;
  title: string;
  prompt: string;
  revisedPrompt?: string;
  image?: GeneratedImage;
  usage?: ImageUsage;
  status: "success" | "error";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 14.3 本地存储建议

初版需要保存：

1. `settings.apiUrl`
2. `settings.apiKey`
3. `generationSettings.model`
4. `generationSettings.size`
5. 当前会话消息
6. 历史生成记录

API Key 初版保存到 localStorage。设置面板需要显示本地保存提示，并提供清除配置能力。

建议 localStorage key：

| Key | 内容 |
| --- | --- |
| `gpt-image.settings` | API URL、API Key |
| `gpt-image.generation-settings` | Model、Size |
| `gpt-image.messages` | 当前对话消息 |
| `gpt-image.history` | 历史生成记录 |

### 14.4 历史记录规则

1. 每次生成请求完成后写入一条历史记录。
2. 成功记录保存 prompt、revised_prompt、图片 URL 或 base64、usage、创建时间。
3. 失败记录保存 prompt、错误信息、创建时间，便于用户重试。
4. 历史记录按时间倒序展示。
5. 点击历史记录后，在主对话区恢复对应生成结果。
6. 用户可以删除单条历史记录。
7. 用户可以清空全部历史记录。
8. 首版历史记录仅保存在当前浏览器，不跨设备同步。

## 15. UI 设计约束

### 15.1 整体风格

1. 类 ChatGPT 的单页对话体验。
2. 类 NewAPI 的后台工具风格：克制、清晰、信息密度适中。
3. 页面不要做营销落地页，打开后直接进入可用工具。
4. 主视觉重点是对话流和生成图片，不需要大面积装饰元素。

### 15.2 布局细节

1. 首版面向 PC 端浏览器，推荐宽度不低于 1280px。
2. 桌面端采用左侧历史栏 + 中间对话区 + 顶部设置入口。
3. 底部输入区固定在视口底部或主内容底部。
4. 图片结果保持稳定宽高比例，避免加载时页面跳动。
5. 错误消息与普通回复视觉区分，但不要过度警告化。
6. 移动端专项适配不纳入首版验收范围。

### 15.3 关键交互状态

1. 默认空状态：展示一个简洁的输入引导。
2. 配置缺失状态：发送时引导用户打开设置。
3. 生成中状态：显示加载动画和“正在生成图片...”。
4. 成功状态：展示图片和操作按钮。
5. 失败状态：展示错误原因和重试按钮。

## 16. 开发里程碑

### 16.1 M1：基础可用版本

目标：完成从输入提示词到生成图片展示的闭环。

范围：

1. 搭建前端页面。
2. 实现连接设置面板。
3. 实现输入区生成参数设置。
4. 实现浏览器前端直连图片生成接口。
5. 实现对话消息流。
6. 实现图片展示和错误提示。
7. 实现 Docker 构建和运行。
8. 实现历史记录 localStorage 持久化。
9. 实现 PC 端布局。

验收：

1. 配置 API URL、API Key、Model、Size 后可生成图片。
2. Model、Size 可在输入框附近完成调整。
3. 请求失败时能展示错误原因。
4. 刷新页面后配置不丢失。
5. 执行 Docker 构建并运行后，可以在浏览器中访问应用。
6. 刷新页面后历史记录不丢失。
7. PC 端主要布局无明显错位或遮挡。

### 16.2 M2：体验增强版本

目标：提高日常使用效率。

范围：

1. 图片下载。
2. 复制图片地址。
3. 复制提示词。
4. 重新生成。
5. 删除单条历史记录。
6. 清空全部历史记录。

验收：

1. 用户可以对生成结果执行常见操作。
2. 用户可以管理本地历史记录。

### 16.3 M3：扩展版本

目标：支持更完整的生产使用场景。

范围：

1. 多会话历史。
2. 多模型和多尺寸预设。
3. 用户登录。
4. 服务端保存 API Key 和历史记录。
5. 多服务商兼容。
6. 移动端适配。

## 17. 初版默认决策

初版按以下方案推进：

1. 技术栈：React + TypeScript + Vite + Tailwind CSS。
2. UI：React 组件化实现，样式参考 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 的简洁后台风格。
3. 请求方式：浏览器前端直接请求用户配置的图片生成接口。
4. 配置方式：连接设置面板填写 API URL、API Key；输入区附近设置 Model、Size。
5. 默认接口：`https://xcode.best/v1/images/generations`。
6. 默认模型：`gpt-image-2`。
7. 默认尺寸：`1024x1024`。
8. 响应兼容：支持 `data[].url`、`data[].b64_json`、`data[].revised_prompt` 和 `usage`。
9. 存储：localStorage 保存配置、API Key、当前会话和历史记录。
10. 部署：Docker 多阶段构建，Nginx 托管静态产物。

## 18. Docker 部署要求

初版需要提供以下部署文件：

1. `Dockerfile`：用于构建并运行前端静态应用。
2. `.dockerignore`：排除 `node_modules`、构建产物、日志等无关文件。
3. `nginx.conf`：用于支持单页应用路由回退。
4. `README.md`：说明本地开发、Docker 构建和 Docker 运行命令。

推荐 Docker 构建流程：

```text
node 镜像
  │
  │ npm install / npm ci
  │ npm run build
  ▼
nginx 镜像
  │
  │ 拷贝 dist 到 /usr/share/nginx/html
  │ 使用 nginx.conf
  ▼
运行静态站点
```

建议命令：

```bash
docker build -t gpt-image .
docker run --rm -p 8080:80 gpt-image
```

运行后访问：

```text
http://localhost:8080
```

## 19. 变更记录

### 2026-06-23

1. 确认技术栈为 React + TypeScript + Vite + Tailwind CSS。
2. 确认初版 API Key 保存在浏览器 localStorage。
3. 确认 UI 参考项目为 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)。
4. 确认图片生成接口响应包含 `url`、`b64_json`、`revised_prompt` 和 `usage`。
5. 确认项目需要支持 Docker 部署。
6. 确认首版需要本地持久化历史记录。
7. 确认首版不支持多图生成。
8. 确认首版不需要深色模式。
9. 确认首版只做 PC 端适配。
10. 确认 Model、Size 等生成参数放在输入框附近设置。
11. 根据 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 生图工作台重构为独立工作台形态：左侧生成记录、中间提示词/参考图/参数、右侧结果网格。
12. 请求方式调整为 Base URL 自动拼接 OpenAI 兼容路径，文生图使用 `/images/generations`，参考图编辑使用 `/images/edits`。
13. 图片持久化调整为 IndexedDB 保存图片 Blob，localStorage 仅保存配置与历史元数据。
14. 支持通过 `?apiKey={key}&baseUrl={address}` 从外部系统导入接口配置，导入后自动清理地址栏敏感参数。
