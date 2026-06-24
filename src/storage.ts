import type { AiConfig, GenerationLog, GeneratedImage, ReferenceImage } from "./types";

export const CONFIG_STORE_KEY = "gpt-image-workbench:ai-config";
export const LOG_STORE_KEY = "gpt-image-workbench:generation-logs";
const DB_NAME = "gpt-image-workbench";
const DB_VERSION = 1;
const IMAGE_STORE = "image_files";

export const DEFAULT_CONFIG: AiConfig = {
  baseUrl: "https://xcode.best",
  apiKey: "",
  apiFormat: "openai",
  model: "gpt-image-2",
  imageModel: "gpt-image-2",
  quality: "auto",
  size: "1:1",
  count: "1",
  systemPrompt: "",
  models: ["gpt-image-2"],
  imageModels: ["gpt-image-2"],
};

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORE_KEY);
    if (!raw) return applyUrlConfig(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return applyUrlConfig(normalizeConfig({ ...DEFAULT_CONFIG, ...parsed }));
  } catch {
    return applyUrlConfig(DEFAULT_CONFIG);
  }
}

export function readUrlConfig() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const apiKey = params.get("apiKey") || params.get("key") || "";
  const baseUrl = params.get("baseUrl") || params.get("url") || "";
  const model = params.get("model") || params.get("imageModel") || "";
  if (!apiKey && !baseUrl && !model) return null;
  return { apiKey, baseUrl, model };
}

export function hasUrlConfig() {
  return Boolean(readUrlConfig());
}

export function clearUrlConfigParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const sensitiveKeys = ["apiKey", "key", "baseUrl", "url", "model", "imageModel"];
  let changed = false;
  sensitiveKeys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function applyUrlConfig(config: AiConfig): AiConfig {
  const imported = readUrlConfig();
  if (!imported) return normalizeConfig(config);
  return normalizeConfig({
    ...config,
    ...(imported.apiKey ? { apiKey: imported.apiKey } : {}),
    ...(imported.baseUrl ? { baseUrl: imported.baseUrl } : {}),
    ...(imported.model ? { model: imported.model, imageModel: imported.model } : {}),
    models: imported.model ? [imported.model, ...config.models] : config.models,
    imageModels: imported.model ? [imported.model, ...config.imageModels] : config.imageModels,
  });
}

export function saveConfig(config: AiConfig) {
  localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(normalizeConfig(config)));
}

export function loadLogs(): GenerationLog[] {
  try {
    const raw = localStorage.getItem(LOG_STORE_KEY);
    if (!raw) return [];
    const logs = JSON.parse(raw);
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

export function saveLogs(logs: GenerationLog[]) {
  const serialized = logs.map(serializeLog);
  localStorage.setItem(LOG_STORE_KEY, JSON.stringify(serialized.slice(0, 100)));
}

export function serializeLog(log: GenerationLog): GenerationLog {
  return {
    ...log,
    references: log.references.map((item) => ({
      ...item,
      dataUrl: item.storageKey ? "" : item.dataUrl,
    })),
    images: log.images.map((image) => ({
      ...image,
      dataUrl: image.storageKey ? "" : image.dataUrl,
    })),
    thumbnails: [],
  };
}

export async function normalizeLog(log: GenerationLog): Promise<GenerationLog> {
  const references = await Promise.all(
    (log.references || []).map(async (item) => ({
      ...item,
      dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
    })),
  );
  const images = await Promise.all(
    (log.images || []).map(async (item) => ({
      ...item,
      dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
    })),
  );

  return {
    ...log,
    references,
    images,
    thumbnails: images.map((image) => image.dataUrl).filter(Boolean).slice(0, 4),
  };
}

export async function uploadImage(input: Blob | File | string) {
  const blob = typeof input === "string" ? dataUrlToBlob(input) : input;
  const id = createId("image");
  const storageKey = `image:${id}`;
  const dataUrl = typeof input === "string" ? input : await blobToDataUrl(blob);
  const meta = await readImageMeta(dataUrl);

  await putImageBlob(storageKey, blob);

  return {
    id,
    storageKey,
    url: URL.createObjectURL(blob),
    width: meta.width,
    height: meta.height,
    bytes: blob.size,
    mimeType: blob.type || "image/png",
  };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
  if (!storageKey) return fallback;
  const blob = await getImageBlob(storageKey);
  return blob ? URL.createObjectURL(blob) : fallback;
}

export async function resolveImageBlob(image: ReferenceImage): Promise<Blob> {
  if (image.storageKey) {
    const stored = await getImageBlob(image.storageKey);
    if (stored && stored.size > 0) return stored;
  }

  if (image.dataUrl.startsWith("data:")) {
    const blob = dataUrlToBlob(image.dataUrl);
    if (blob.size > 0) return blob;
  }

  if (image.dataUrl) {
    const response = await fetch(image.dataUrl);
    if (!response.ok) throw new Error(`读取参考图失败：${response.status}`);
    const blob = await response.blob();
    if (blob.size > 0) return blob;
  }

  throw new Error("参考图文件为空，请重新上传参考图");
}

export async function deleteStoredImages(keys: string[]) {
  const db = await openDb();
  await Promise.all(
    keys.map(
      (key) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IMAGE_STORE, "readwrite");
          tx.objectStore(IMAGE_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    ),
  );
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeConfig(config: AiConfig): AiConfig {
  const models = unique([...(config.models || []), config.model, config.imageModel]);
  const imageModels = unique([...(config.imageModels || []), config.imageModel, config.model]);
  return {
    ...DEFAULT_CONFIG,
    ...config,
    baseUrl: config.baseUrl || DEFAULT_CONFIG.baseUrl,
    apiFormat: config.apiFormat === "gemini" ? "gemini" : "openai",
    model: config.imageModel || config.model || DEFAULT_CONFIG.model,
    imageModel: config.imageModel || config.model || DEFAULT_CONFIG.imageModel,
    quality: config.quality || DEFAULT_CONFIG.quality,
    size: config.size || DEFAULT_CONFIG.size,
    count: String(Math.max(1, Math.min(10, Number(config.count) || 1))),
    models,
    imageModels,
  };
}

export function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(ms: number) {
  if (!ms) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getDataUrlByteSize(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

export function readImageMeta(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, payload = ""] = dataUrl.split(",");
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] || "image/png";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export async function dataUrlToFile(image: ReferenceImage, fallbackName = "reference.png") {
  const blob = await resolveImageBlob(image);
  return new File([blob], image.name || fallbackName, { type: blob.type || image.type || "image/png" });
}

async function putImageBlob(key: string, blob: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getImageBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
