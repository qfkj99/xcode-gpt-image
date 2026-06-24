export type ApiFormat = "openai" | "gemini";

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
  model: string;
  imageModel: string;
  quality: string;
  size: string;
  count: string;
  systemPrompt: string;
  models: string[];
  imageModels: string[];
};

export type ReferenceImage = {
  id: string;
  name: string;
  type?: string;
  dataUrl: string;
  storageKey?: string;
};

export type GeneratedImage = {
  id: string;
  dataUrl: string;
  storageKey?: string;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  mimeType?: string;
};

export type GenerationResult = {
  id: string;
  status: "pending" | "success" | "failed";
  image?: GeneratedImage;
  error?: string;
};

export type GenerationLogConfig = Pick<
  AiConfig,
  "model" | "imageModel" | "quality" | "size" | "count"
>;

export type GenerationLog = {
  id: string;
  createdAt: number;
  title: string;
  prompt: string;
  time: string;
  model: string;
  config: GenerationLogConfig;
  references: ReferenceImage[];
  durationMs: number;
  successCount: number;
  failCount: number;
  imageCount: number;
  size: string;
  quality: string;
  status: "成功" | "失败";
  images: GeneratedImage[];
  thumbnails: string[];
};
