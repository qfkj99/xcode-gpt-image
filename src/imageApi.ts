import { createId, dataUrlToFile } from "./storage";
import type { AiConfig, ReferenceImage } from "./types";

type ImageApiResponse = {
  data?: Array<Record<string, unknown>>;
  error?: { message?: string };
  code?: number;
  msg?: string;
};

const QUALITY_BASE: Record<string, number> = {
  low: 1024,
  medium: 2048,
  high: 2880,
  standard: 1024,
  hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

export type ApiImage = {
  id: string;
  dataUrl: string;
};

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestInit) {
  const n = generationCount(config.count);
  const quality = normalizeQuality(config.quality);
  const requestSize = resolveRequestSize(quality, config.size);
  const response = await fetch(buildApiUrl(config.baseUrl, "/images/generations"), {
    method: "POST",
    headers: aiHeaders(config, "application/json"),
    body: JSON.stringify({
      model: config.imageModel || config.model,
      prompt: withSystemPrompt(config, prompt),
      n,
      ...(quality ? { quality } : {}),
      ...(requestSize ? { size: requestSize } : {}),
      response_format: "b64_json",
      output_format: IMAGE_OUTPUT_FORMAT,
    }),
    ...options,
  });

  return parseImageResponse(response, "请求失败");
}

export async function requestEdit(
  config: AiConfig,
  prompt: string,
  references: ReferenceImage[],
  options?: RequestInit,
) {
  const n = generationCount(config.count);
  const quality = normalizeQuality(config.quality);
  const requestSize = resolveRequestSize(quality, config.size);
  const formData = new FormData();

  formData.set("model", config.imageModel || config.model);
  formData.set("prompt", withSystemPrompt(config, buildImageReferencePromptText(prompt, references)));
  formData.set("n", String(n));
  formData.set("response_format", "b64_json");
  formData.set("output_format", IMAGE_OUTPUT_FORMAT);
  if (quality) formData.set("quality", quality);
  if (requestSize) formData.set("size", requestSize);

  const files = await Promise.all(references.map((image) => dataUrlToFile(image)));
  files.forEach((file) => formData.append("image", file));

  const response = await fetch(buildApiUrl(config.baseUrl, "/images/edits"), {
    method: "POST",
    headers: aiHeaders(config),
    body: formData,
    ...options,
  });

  return parseImageResponse(response, "请求失败");
}

export function buildApiUrl(baseUrl: string, path: string) {
  let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
  const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
  const apiBaseUrl =
    lowerBaseUrl.endsWith("/v1") ||
    lowerBaseUrl.endsWith("/api/v3") ||
    lowerBaseUrl.endsWith("/api/plan/v3")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
  return `${apiBaseUrl}${path}`;
}

export function generationCount(count: string) {
  return Math.max(1, Math.min(10, Math.floor(Math.abs(Number(count)) || 1)));
}

export function imageQualityLabel(value: string) {
  return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
  return ASPECT_OPTIONS.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

export const ASPECT_OPTIONS = [
  { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
  { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
  { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
  { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
  { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
  { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
  { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
  { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
  { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
  { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
  { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

export const QUALITY_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

async function parseImageResponse(response: Response, fallback: string) {
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(readStatusError(response.status, payload, fallback));
  if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || fallback);

  const images =
    payload.data
      ?.map(resolveImageDataUrl)
      .filter((value): value is string => Boolean(value))
      .map((dataUrl) => ({ id: createId("result"), dataUrl })) || [];

  if (!images.length) throw new Error("接口没有返回图片");
  return images;
}

async function readPayload(response: Response): Promise<ImageApiResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ImageApiResponse;
  } catch {
    if (!response.ok) return { msg: text.slice(0, 300) };
    throw new Error("接口响应不是有效 JSON");
  }
}

function resolveImageDataUrl(item: Record<string, unknown>) {
  if (typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (typeof item.url === "string" && item.url) return item.url;
  return null;
}

function aiHeaders(config: AiConfig, contentType?: string) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function withSystemPrompt(config: AiConfig, prompt: string) {
  const systemPrompt = config.systemPrompt.trim();
  return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function normalizeQuality(quality: string) {
  const value = quality.trim().toLowerCase();
  if (!value || value === "auto") return undefined;
  const normalized = QUALITY_ALIASES[value] || value;
  return QUALITY_BASE[normalized] ? normalized : undefined;
}

function resolveRequestSize(quality: string | undefined, size: string) {
  const value = size.trim();
  if (!value || value.toLowerCase() === "auto") return undefined;
  const dimensions = parseImageDimensions(value);
  if (dimensions) {
    validateImageSize(dimensions.width, dimensions.height);
    return `${dimensions.width}x${dimensions.height}`;
  }
  if (value.includes(":")) return resolveSize(quality, value);
  throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveSize(quality: string | undefined, ratio: string): string {
  const parsedRatio = parseImageRatio(ratio);
  const basePixels = quality ? QUALITY_BASE[quality] : undefined;
  const isLandscape = parsedRatio.width >= parsedRatio.height;
  const longRatio = isLandscape
    ? parsedRatio.width / parsedRatio.height
    : parsedRatio.height / parsedRatio.width;
  let longSide: number;
  let shortSide: number;

  if (basePixels) {
    const targetPixels = basePixels * basePixels;
    const longSideRaw = Math.sqrt(targetPixels * longRatio);
    longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  } else {
    shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  }

  const width = isLandscape ? longSide : shortSide;
  const height = isLandscape ? shortSide : longSide;
  validateImageSize(width, height);
  return `${width}x${height}`;
}

function parseImageRatio(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("图像比例必须是正数，例如 9:16");
  }
  if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) {
    throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
  }
  return { width, height };
}

function parseImageDimensions(value: string) {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("图像尺寸必须是正整数，例如 1024x1024");
  }
  if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) {
    throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
  }
  if (Math.max(width, height) > IMAGE_MAX_EDGE) {
    throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
  }
  if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) {
    throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
  }
  const pixels = width * height;
  if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) {
    throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
  }
}

function readStatusError(status: number, payload: ImageApiResponse, fallback: string) {
  if (payload.msg) return payload.msg;
  if (payload.error?.message) return payload.error.message;
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
  if (status === 429) return "请求被限流或额度不足，请稍后重试";
  return `${fallback}：${status}`;
}

function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
  if (!references.length) return prompt;
  const labels = references.map((_, index) => `参考图 ${index + 1}`).join("、");
  return `${prompt}\n\n请结合${labels}进行图像生成或编辑。`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    const lowerPath = path.toLowerCase();
    const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
    if (arkPlanIndex < 0) return baseUrl;
    const end = arkPlanIndex + "/api/plan/v3".length;
    if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
    url.pathname = path.slice(0, end);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}
