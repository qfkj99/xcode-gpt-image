import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  ClipboardPaste,
  Download,
  FolderPlus,
  History,
  ImagePlus,
  LoaderCircle,
  PenLine,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ASPECT_OPTIONS,
  generationCount,
  imageQualityLabel,
  imageSizeLabel,
  QUALITY_OPTIONS,
  requestEdit,
  requestGeneration,
} from "./imageApi";
import type { ApiImage } from "./imageApi";
import {
  createId,
  clearUrlConfigParams,
  deleteStoredImages,
  formatBytes,
  formatDuration,
  getDataUrlByteSize,
  hasUrlConfig,
  loadConfig,
  loadLogs,
  normalizeLog,
  readImageMeta,
  saveConfig,
  saveLogs,
  uploadImage,
} from "./storage";
import type { AiConfig, GeneratedImage, GenerationLog, GenerationResult, ReferenceImage } from "./types";

type GenerationSnapshot = {
  prompt: string;
  config: AiConfig;
  references: ReferenceImage[];
};

type BatchGenerationSummary = {
  images: GeneratedImage[];
  error?: string;
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [config, setConfig] = useState<AiConfig>(() => loadConfig());
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [logs, setLogs] = useState<GenerationLog[]>(() =>
    loadLogs().sort((a, b) => b.createdAt - a.createdAt),
  );
  const logsHydratedRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [imagePreview, setImagePreview] = useState<{ src: string; title: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const model = config.imageModel || config.model;
  const canGenerate = Boolean(prompt.trim());
  const count = generationCount(config.count);

  useEffect(() => {
    if (!hasUrlConfig()) return;
    saveConfig(config);
    clearUrlConfigParams();
    showNotice("已从链接导入接口配置");
  }, []);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  useEffect(() => {
    if (logsHydratedRef.current) return;
    logsHydratedRef.current = true;
    void Promise.all(loadLogs().map(normalizeLog)).then((items) => {
      if (items.length) setLogs(items.sort((a, b) => b.createdAt - a.createdAt));
    });
  }, []);

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  async function addReferences(files?: FileList | null) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const next = await Promise.all(
      imageFiles.map(async (file) => {
        const stored = await uploadImage(file);
        return {
          id: createId("ref"),
          name: file.name,
          type: stored.mimeType,
          dataUrl: stored.url,
          storageKey: stored.storageKey,
        };
      }),
    );
    setReferences((current) => [...current, ...next]);
  }

  async function addReferencesFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      const blobs = await Promise.all(
        items.flatMap((item) =>
          item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type)),
        ),
      );
      if (!blobs.length) {
        showNotice("剪切板里没有可读取的图片");
        return;
      }
      const next = await Promise.all(
        blobs.map(async (blob, index) => {
          const stored = await uploadImage(blob);
          return {
            id: createId("ref"),
            name: `clipboard-${index + 1}.png`,
            type: stored.mimeType,
            dataUrl: stored.url,
            storageKey: stored.storageKey,
          };
        }),
      );
      setReferences((current) => [...current, ...next]);
      showNotice(`已读取 ${next.length} 张参考图`);
    } catch {
      showNotice("剪切板里没有可读取的图片");
    }
  }

  async function generate() {
    const text = prompt.trim();
    if (!text) {
      showNotice("请输入生图提示词");
      return;
    }
    if (!config.baseUrl.trim() || !config.apiKey.trim() || !model.trim()) {
      setSettingsOpen(true);
      showNotice("请先完成接口和模型配置");
      return;
    }

    setPreviewLog(null);
    setElapsedMs(0);
    setRunning(true);
    setResults(Array.from({ length: count }, () => ({ id: createId("slot"), status: "pending" })));
    const batchStartedAt = performance.now();
    setStartedAt(batchStartedAt);

    const snapshot: GenerationSnapshot = {
      prompt: text,
      references: [...references],
      config: { ...config, model, imageModel: model, count: String(count) },
    };
    const { images: successImages, error } = await runGenerationBatch(snapshot, count);
    const failCount = count - successImages.length;
    const firstFailed = error ? { reason: new Error(error) } : undefined;

    try {
      const log = buildLog({
        prompt: text,
        model,
        config: snapshot.config,
        references: snapshot.references,
        durationMs: performance.now() - batchStartedAt,
        successCount: successImages.length,
        failCount,
        status: successImages.length ? "成功" : "失败",
        images: successImages,
      });
      setPreviewLog(log);
      setLogs((current) => [log, ...current].slice(0, 100));
      showNotice(successImages.length ? "图片已生成" : firstFailed?.reason?.message || "生成失败");
    } finally {
      setRunning(false);
    }
  }

  async function runGenerationBatch(snapshot: GenerationSnapshot, expectedCount: number): Promise<BatchGenerationSummary> {
    const itemStartedAt = performance.now();
    try {
      const images = snapshot.references.length
        ? await requestEdit(snapshot.config, snapshot.prompt, snapshot.references)
        : await requestGeneration(snapshot.config, snapshot.prompt);
      const limitedImages = images.slice(0, expectedCount);
      const settled = await Promise.allSettled(
        limitedImages.map(async (image, index) => {
          try {
            const nextImage = await persistGeneratedImage(image, itemStartedAt);
            setResults((current) => updateResultAt(current, index, { status: "success", image: nextImage }));
            return nextImage;
          } catch (error) {
            const message = error instanceof Error ? error.message : "生成失败";
            setResults((current) => updateResultAt(current, index, { status: "failed", error: message }));
            throw new Error(message);
          }
        }),
      );
      const successImages = settled
        .filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled")
        .map((item) => item.value);
      const firstFailed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");

      if (limitedImages.length < expectedCount) {
        const message = "接口返回图片数量不足";
        setResults((current) =>
          current.map((item, index) => (index >= limitedImages.length ? { ...item, status: "failed", error: message } : item)),
        );
        return { images: successImages, error: firstFailed?.reason?.message || message };
      }

      return { images: successImages, error: firstFailed?.reason?.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setResults((current) => current.map((item) => ({ ...item, status: "failed", error: message })));
      return { images: [], error: message };
    }
  }

  async function persistGeneratedImage(image: ApiImage, itemStartedAt: number): Promise<GeneratedImage> {
    const meta = await readImageMeta(image.dataUrl);
    const stored = await uploadImage(image.dataUrl);
    return {
      id: image.id,
      dataUrl: stored.url,
      storageKey: stored.storageKey,
      durationMs: performance.now() - itemStartedAt,
      width: stored.width || meta.width,
      height: stored.height || meta.height,
      bytes: stored.bytes || getDataUrlByteSize(image.dataUrl),
      mimeType: stored.mimeType,
    };
  }

  async function runGenerationSlot(
    index: number,
    snapshot: GenerationSnapshot,
  ) {
    const itemStartedAt = performance.now();
    try {
      const images = snapshot.references.length
        ? await requestEdit(snapshot.config, snapshot.prompt, snapshot.references)
        : await requestGeneration(snapshot.config, snapshot.prompt);
      const image = images[0];
      if (!image) throw new Error("接口没有返回图片");
      const meta = await readImageMeta(image.dataUrl);
      const stored = await uploadImage(image.dataUrl);
      const nextImage: GeneratedImage = {
        id: image.id,
        dataUrl: stored.url,
        storageKey: stored.storageKey,
        durationMs: performance.now() - itemStartedAt,
        width: stored.width || meta.width,
        height: stored.height || meta.height,
        bytes: stored.bytes || getDataUrlByteSize(image.dataUrl),
        mimeType: stored.mimeType,
      };
      setResults((current) => updateResultAt(current, index, { status: "success", image: nextImage }));
      return nextImage;
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setResults((current) => updateResultAt(current, index, { status: "failed", error: message }));
      throw new Error(message);
    }
  }

  function retryResult(index: number) {
    if (!prompt.trim()) return;
    const snapshot: GenerationSnapshot = { prompt: prompt.trim(), references: [...references], config: { ...config, model, imageModel: model, count: "1" } };
    setResults((current) => updateResultAt(current, index, { status: "pending", error: undefined, image: undefined }));
    void runGenerationSlot(index, snapshot)
      .then((image) => syncRetryToActiveLog(index, image, snapshot))
      .catch(() => undefined);
  }

  async function previewGenerationLog(log: GenerationLog) {
    const normalized = await normalizeLog(log);
    setPreviewLog(normalized);
    setPrompt(normalized.prompt);
    setReferences(normalized.references || []);
    setConfig((current) => ({ ...current, ...normalized.config, imageModel: normalized.config.imageModel || normalized.model }));
    setResults(
      normalized.images.length
        ? normalized.images.map((image) => ({ id: image.id, status: "success", image }))
        : [{ id: createId("slot"), status: "failed", error: normalized.status === "失败" ? "生成失败，可点击重试" : "没有生成图片" }],
    );
  }

  function syncRetryToActiveLog(
    index: number,
    image: GeneratedImage,
    snapshot: GenerationSnapshot,
  ) {
    const updatedAt = Date.now();
    setPreviewLog((currentPreviewLog) => {
      if (!currentPreviewLog) return currentPreviewLog;
      const nextImages = replaceImageAt(currentPreviewLog.images, index, image);
      const nextLog: GenerationLog = {
        ...currentPreviewLog,
        prompt: snapshot.prompt,
        title: snapshot.prompt.slice(0, 12) || currentPreviewLog.title || "未命名",
        model,
        config: {
          model: snapshot.config.model,
          imageModel: snapshot.config.imageModel,
          quality: snapshot.config.quality,
          size: snapshot.config.size,
          count: snapshot.config.count,
        },
        references: snapshot.references,
        images: nextImages,
        thumbnails: nextImages
          .map((item) => item.dataUrl)
          .filter(Boolean)
          .slice(0, 4),
        durationMs: image.durationMs,
        successCount: Math.max(1, currentPreviewLog.successCount || 0),
        failCount: Math.max(0, (currentPreviewLog.failCount || 1) - 1),
        imageCount: Math.max(currentPreviewLog.imageCount || 1, index + 1),
        size: snapshot.config.size,
        quality: snapshot.config.quality,
        status: "成功",
        time: new Date(updatedAt).toLocaleString("zh-CN", { hour12: false }),
      };
      setLogs((current) =>
        current.map((log) => (log.id === nextLog.id ? nextLog : log)).sort((a, b) => b.createdAt - a.createdAt),
      );
      return nextLog;
    });
  }

  async function deleteSelectedLogs() {
    const deleting = logs.filter((log) => selectedLogIds.includes(log.id));
    const imageKeys = deleting.flatMap((log) => [
      ...log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)),
      ...log.references.map((image) => image.storageKey).filter((key): key is string => Boolean(key)),
    ]);
    await deleteStoredImages(imageKeys);
    setLogs((current) => current.filter((log) => !selectedLogIds.includes(log.id)));
    if (previewLog && selectedLogIds.includes(previewLog.id)) {
      createSession();
    }
    setSelectedLogIds([]);
  }

  function createSession() {
    setPrompt("");
    setReferences([]);
    setResults([]);
    setPreviewLog(null);
    setSelectedLogIds([]);
    setElapsedMs(0);
    setStartedAt(0);
  }

  function continueEditWithImage(image: GeneratedImage, index: number) {
    const reference: ReferenceImage = {
      id: createId("ref"),
      name: `generated-result-${index + 1}.png`,
      type: image.mimeType || "image/png",
      dataUrl: image.dataUrl,
      storageKey: image.storageKey,
    };
    setReferences((current) => [...current, reference]);
    showNotice("已加入参考图，可继续输入编辑要求");
    window.setTimeout(() => {
      promptInputRef.current?.focus();
    }, 0);
  }

  function updateConfig<K extends keyof AiConfig>(key: K, value: AiConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900">
      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-3 overflow-hidden p-3">
        <aside className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <LogPanel
            logs={logs}
            selectedLogIds={selectedLogIds}
            activeLogId={previewLog?.id}
            onSelectedLogIdsChange={setSelectedLogIds}
            onCreateSession={createSession}
            onDeleteSelected={() => void deleteSelectedLogs()}
            onPreviewLog={(log) => void previewGenerationLog(log)}
            onPreviewImage={(src, title) => setImagePreview({ src, title })}
          />
        </aside>

        <section className="grid min-h-0 grid-cols-[420px_minmax(0,1fr)] gap-3 overflow-hidden">
          <div className="thin-scrollbar flex min-h-0 flex-col overflow-y-auto rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-stone-950">Xcode 生图工作台</h1>
                <p className="mt-1 text-sm text-stone-500">生成的图片不会在云端保存记录，请及时保存！</p>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(true)} title="接口配置">
                <Settings size={17} />
              </button>
            </div>

            <div className="mt-6 space-y-5">
              <PromptPanel prompt={prompt} setPrompt={setPrompt} inputRef={promptInputRef} />
              <ReferencePanel
                references={references}
                setReferences={setReferences}
                fileInputRef={fileInputRef}
                onPaste={() => void addReferencesFromClipboard()}
              />
              <GenerationSettings config={config} model={model} updateConfig={updateConfig} />
            </div>

            <div className="mt-auto pt-6">
              <button className="primary-button h-11 w-full text-base" disabled={!canGenerate || running} onClick={() => void generate()}>
                {running ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}
                开始生成
              </button>
            </div>
          </div>

          <ResultPanel
            results={results}
            running={running}
            elapsedMs={elapsedMs}
            onRetry={retryResult}
            onPreviewImage={(src, title) => setImagePreview({ src, title })}
            onContinueEdit={continueEditWithImage}
          />
        </section>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void addReferences(event.target.files);
          event.target.value = "";
        }}
      />

      {settingsOpen && (
        <ConfigModal
          config={config}
          setConfig={setConfig}
          onClose={() => setSettingsOpen(false)}
          onNotice={showNotice}
        />
      )}
      {imagePreview && (
        <ImagePreviewModal
          src={imagePreview.src}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
        />
      )}
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}

function PromptPanel({
  prompt,
  setPrompt,
  inputRef,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-base font-semibold">提示词</span>
        <button
          className="small-button"
          disabled={!prompt}
          onClick={() => {
            setPrompt("");
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          <X size={14} />
          清空
        </button>
      </div>
      <textarea
        ref={inputRef}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={7}
        className="field-textarea"
        placeholder="描述画面主体、风格、构图、光线和用途"
      />
    </section>
  );
}

function ReferencePanel({
  references,
  setReferences,
  fileInputRef,
  onPaste,
}: {
  references: ReferenceImage[];
  setReferences: (value: ReferenceImage[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPaste: () => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-base font-semibold">参考图</span>
        <div className="flex gap-2">
          <button className="small-button" onClick={onPaste}>
            <ClipboardPaste size={14} />
            剪切板
          </button>
          <button className="small-button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} />
            上传
          </button>
        </div>
      </div>
      <div className="hover-scrollbar flex min-h-24 gap-2 overflow-x-auto rounded-lg border border-dashed border-stone-300 p-2">
        {references.length ? (
          references.map((item, index) => (
            <div key={item.id} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-stone-200">
              <img src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                图 {index + 1}
              </span>
              <button
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white/90 opacity-0 shadow group-hover:opacity-100"
                onClick={() => setReferences(references.filter((image) => image.id !== item.id))}
              >
                <X size={12} />
              </button>
              <ReferenceOrderButtons
                index={index}
                total={references.length}
                onMove={(offset) => setReferences(moveListItem(references, index, offset))}
              />
            </div>
          ))
        ) : (
          <div className="flex min-w-full items-center justify-center text-sm text-stone-500">
            上传参考图后将使用图生图 / 编辑接口
          </div>
        )}
      </div>
    </section>
  );
}

function GenerationSettings({
  config,
  model,
  updateConfig,
}: {
  config: AiConfig;
  model: string;
  updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
}) {
  const count = generationCount(config.count);
  return (
    <section className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-base font-semibold">模型</span>
        <ModelInput config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} />
      </label>

      <div className="space-y-2.5">
        <SettingTitle>质量</SettingTitle>
        <div className="grid grid-cols-4 gap-2.5">
          {QUALITY_OPTIONS.map((item) => (
            <button
              key={item.value}
              className={config.quality === item.value ? "option-pill selected" : "option-pill"}
              onClick={() => updateConfig("quality", item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <SizeSettings config={config} updateConfig={updateConfig} />

      <div className="space-y-2.5">
        <SettingTitle>生成张数</SettingTitle>
        <div className="grid grid-cols-5 gap-2.5">
          {Array.from({ length: 4 }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              className={count === value ? "option-pill selected" : "option-pill"}
              onClick={() => updateConfig("count", String(value))}
            >
              {value} 张
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500">
        当前请求：{imageQualityLabel(config.quality)} · {imageSizeLabel(config.size)} · {count} 张
      </div>
    </section>
  );
}

function ModelInput({
  config,
  value,
  onChange,
}: {
  config: AiConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = Array.from(new Set([value, ...config.imageModels, ...config.models].filter(Boolean)));
  return (
    <div className="space-y-2">
      <input className="field-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="gpt-image-2" />
      <div className="flex flex-wrap gap-2">
        {options.map((item) => (
          <button key={item} className={item === value ? "model-chip selected" : "model-chip"} onClick={() => onChange(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function SizeSettings({
  config,
  updateConfig,
}: {
  config: AiConfig;
  updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
}) {
  const activeSize = config.size || "auto";
  const selectedAspect = ASPECT_OPTIONS.find((item) => (item.size || item.value) === activeSize || item.value === activeSize);
  const dimensions = readSizeDimensions(activeSize, selectedAspect || ASPECT_OPTIONS[0]);

  function updateDimension(key: "width" | "height", value: number | null) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
    const width = key === "width" ? alignDimension(next) : dimensions.width;
    const height = key === "height" ? alignDimension(next) : dimensions.height;
    updateConfig("size", `${width}x${height}`);
  }

  return (
    <>
      <div className="space-y-2.5">
        <SettingTitle>尺寸</SettingTitle>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
          <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} onChange={(value) => updateDimension("width", value)} />
          <span className="text-lg text-stone-400">↔</span>
          <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} onChange={(value) => updateDimension("height", value)} />
        </div>
      </div>

      <div className="space-y-2.5">
        <SettingTitle>宽高比</SettingTitle>
        <div className="grid grid-cols-4 gap-2.5">
          {ASPECT_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={selectedAspect?.value === item.value ? "aspect-button selected" : "aspect-button"}
              onClick={() => updateConfig("size", item.size || item.value)}
            >
              <AspectIcon type={item.icon} width={item.width} height={item.height} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ResultPanel({
  results,
  running,
  elapsedMs,
  onRetry,
  onPreviewImage,
  onContinueEdit,
}: {
  results: GenerationResult[];
  running: boolean;
  elapsedMs: number;
  onRetry: (index: number) => void;
  onPreviewImage: (src: string, title: string) => void;
  onContinueEdit: (image: GeneratedImage, index: number) => void;
}) {
  return (
    <div className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">生成结果</h2>
        {running ? <span className="tag">等待 {formatDuration(elapsedMs)}</span> : null}
      </div>
      {results.length ? (
        <div className="grid auto-rows-auto gap-4 xl:grid-cols-2">
          {results.map((result, index) =>
            result.status === "success" && result.image ? (
              <ResultImageCard
                key={result.id}
                image={result.image}
                index={index}
                onPreviewImage={onPreviewImage}
                onContinueEdit={onContinueEdit}
              />
            ) : result.status === "failed" ? (
              <FailedImageCard key={result.id} error={result.error || "生成失败"} onRetry={() => onRetry(index)} />
            ) : (
              <PendingImageCard key={result.id} />
            ),
          )}
        </div>
      ) : (
        <div className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center">
          <ImagePlus className="mb-4 text-stone-400" size={44} />
          <div className="text-base font-medium text-stone-600">还没有生成图片</div>
          <p className="mt-2 text-sm text-stone-500">填写提示词后，点击左侧的开始生成。</p>
        </div>
      )}
    </div>
  );
}

function ResultImageCard({
  image,
  index,
  onPreviewImage,
  onContinueEdit,
}: {
  image: GeneratedImage;
  index: number;
  onPreviewImage: (src: string, title: string) => void;
  onContinueEdit: (image: GeneratedImage, index: number) => void;
}) {
  const aspectRatio = image.width && image.height ? `${image.width} / ${image.height}` : "1 / 1";
  const ratio = image.width && image.height ? image.width / image.height : 1;
  const isWideImage = ratio >= 1.6;
  const title = `生成结果 ${index + 1}`;

  return (
    <div className={isWideImage ? "overflow-hidden rounded-lg border border-stone-200 bg-white xl:col-span-2" : "overflow-hidden rounded-lg border border-stone-200 bg-white"}>
      <div
        className={isWideImage ? "group relative flex min-h-[360px] max-h-[720px] w-full items-center justify-center bg-stone-100" : "group relative flex min-h-[300px] max-h-[680px] w-full items-center justify-center bg-stone-100"}
        style={{ aspectRatio }}
        onDoubleClick={() => onPreviewImage(image.dataUrl, title)}
        title="双击放大查看"
      >
        <img
          src={image.dataUrl}
          alt={title}
          className="h-full w-full object-contain"
        />
        <div className="pointer-events-none absolute right-2 top-2 hidden rounded-full bg-black/55 p-1.5 text-white group-hover:block">
          <ZoomIn size={15} />
        </div>
      </div>
      <div className="space-y-2 border-t border-stone-200 px-3 py-2.5">
        <div className="flex min-w-0 gap-2 text-xs text-stone-500">
          <span>{image.width}x{image.height}</span>
          <span>{formatBytes(image.bytes)}</span>
          <span>{formatDuration(image.durationMs)}</span>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <a className="action-button" href={image.dataUrl} download={`image-${index + 1}.png`}>
            <Download size={14} />
            下载
          </a>
          <button className="action-button" onClick={() => onContinueEdit(image, index)}>
            <FolderPlus size={14} />
            继续编辑
          </button>
          <button className="action-button" onClick={() => navigator.clipboard.writeText(image.dataUrl)}>
            <PenLine size={14} />
            复制地址
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingImageCard() {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500">
        <LoaderCircle className="animate-spin" size={24} />
        <span>生成中</span>
      </div>
    </div>
  );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50">
      <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
        <div className="text-sm font-medium text-red-600">生成失败</div>
        <p className="line-clamp-4 text-xs text-red-500">{error}</p>
      </div>
      <div className="flex justify-end border-t border-red-200 p-3">
        <button className="danger-button" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}

function ImagePreviewModal({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-preview-backdrop" onClick={onClose}>
      <div className="image-preview-toolbar" onClick={(event) => event.stopPropagation()}>
        <span className="truncate text-sm font-medium">{title}</span>
        <button className="image-preview-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
      </div>
      <img
        src={src}
        alt={title}
        className="image-preview-img"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={onClose}
      />
    </div>
  );
}

function LogPanel({
  logs,
  selectedLogIds,
  activeLogId,
  onSelectedLogIdsChange,
  onCreateSession,
  onDeleteSelected,
  onPreviewLog,
  onPreviewImage,
}: {
  logs: GenerationLog[];
  selectedLogIds: string[];
  activeLogId?: string;
  onSelectedLogIdsChange: (ids: string[]) => void;
  onCreateSession: () => void;
  onDeleteSelected: () => void;
  onPreviewLog: (log: GenerationLog) => void;
  onPreviewImage: (src: string, title: string) => void;
}) {
  const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History size={17} />
          <h2 className="text-base font-semibold">生成记录</h2>
        </div>
        <span className="tag">{logs.length}</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="small-button" onClick={onCreateSession}>
          <Plus size={14} />
          新建
        </button>
        <button
          className="small-button"
          disabled={!logs.length}
          onClick={() => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id))}
        >
          <CheckSquare size={14} />
          {allSelected ? "取消" : "全选"}
        </button>
        <button className="small-button danger" disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
          <Trash2 size={14} />
          删除
        </button>
      </div>
      <div className="space-y-3">
        {logs.map((log) => (
          <LogCard
            key={log.id}
            log={log}
            selected={selectedLogIds.includes(log.id)}
            active={activeLogId === log.id}
            onSelectedChange={(checked) =>
              onSelectedLogIdsChange(
                checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id),
              )
            }
            onClick={() => onPreviewLog(log)}
            onPreviewImage={onPreviewImage}
          />
        ))}
        {!logs.length ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500">
            暂无生成记录
          </div>
        ) : null}
      </div>
    </>
  );
}

function LogCard({
  log,
  selected,
  active,
  onSelectedChange,
  onClick,
  onPreviewImage,
}: {
  log: GenerationLog;
  selected: boolean;
  active: boolean;
  onSelectedChange: (checked: boolean) => void;
  onClick: () => void;
  onPreviewImage: (src: string, title: string) => void;
}) {
  const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
  return (
    <button
      type="button"
      className={active ? "log-card active" : "log-card"}
      onClick={onClick}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-stone-950"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
            {thumbnails.length ? (
              <div className="mt-2 flex gap-1 overflow-hidden">
                {thumbnails.map((image, index) => (
                  <img
                    key={`${log.id}-${index}`}
                    src={image}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-md object-cover"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onPreviewImage(image, `${log.title} ${index + 1}`);
                    }}
                    title="双击放大查看"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex gap-1">
            <span className="tag blue">成功 {log.successCount ?? log.imageCount}</span>
            {log.failCount ? <span className="tag red">失败 {log.failCount}</span> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <span className="tag">{log.imageCount} 张</span>
            <span className="tag green">{formatDuration(log.durationMs)}</span>
          </div>
          <span className="tag">{log.time}</span>
        </div>
      </div>
    </button>
  );
}

function ConfigModal({
  config,
  setConfig,
  onClose,
  onNotice,
}: {
  config: AiConfig;
  setConfig: (config: AiConfig) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [modelText, setModelText] = useState(config.models.join("\n"));

  function update<K extends keyof AiConfig>(key: K, value: AiConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-stone-950/35 px-4">
      <div className="w-[680px] rounded-lg bg-white shadow-panel">
        <div className="flex h-14 items-center justify-between border-b border-stone-200 px-5">
          <h2 className="text-base font-semibold">接口配置</h2>
          <button className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="grid gap-4 p-5">
          <label>
            <span className="field-label">Base URL</span>
            <input
              className="field-input"
              value={draft.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
              placeholder="https://xcode.best"
            />
            <span className="mt-1 block text-xs text-stone-500">
              会自动补齐 OpenAI 兼容路径，例如 `/v1/images/generations`。
            </span>
          </label>
          <label>
            <span className="field-label">API Key</span>
            <input
              className="field-input"
              type="password"
              value={draft.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              placeholder="sk-your-api-key"
            />
          </label>
          <label>
            <span className="field-label">默认生图模型</span>
            <input
              className="field-input"
              value={draft.imageModel}
              onChange={(event) => update("imageModel", event.target.value)}
              placeholder="gpt-image-2"
            />
          </label>
          <label>
            <span className="field-label">可选模型，每行一个</span>
            <textarea
              className="field-textarea min-h-28"
              value={modelText}
              onChange={(event) => setModelText(event.target.value)}
              placeholder="gpt-image-2"
            />
          </label>
          <label>
            <span className="field-label">系统提示词，可选</span>
            <textarea
              className="field-textarea min-h-20"
              value={draft.systemPrompt}
              onChange={(event) => update("systemPrompt", event.target.value)}
              placeholder="会自动拼接到用户提示词前"
            />
          </label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            API Key 会保存在当前浏览器本地，并由浏览器直接请求外部接口。
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-4">
          <button className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            onClick={() => {
              const models = modelText
                .split(/\r?\n|,/)
                .map((item) => item.trim())
                .filter(Boolean);
              const next = {
                ...draft,
                models: Array.from(new Set([draft.imageModel, ...models].filter(Boolean))),
                imageModels: Array.from(new Set([draft.imageModel, ...models].filter(Boolean))),
                model: draft.imageModel,
              };
              setConfig(next);
              onClose();
              onNotice("配置已保存");
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function DimensionInput({
  prefix,
  value,
  disabled,
  onChange,
}: {
  prefix: string;
  value: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className={disabled ? "dimension-input disabled" : "dimension-input"}>
      <span>{prefix}</span>
      <input
        type="number"
        min={1}
        disabled={disabled}
        defaultValue={value || ""}
        key={`${prefix}-${value}`}
        onBlur={(event) => onChange(Number(event.currentTarget.value) || null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function AspectIcon({ type, width, height }: { type: string; width: number; height: number }) {
  if (type === "auto") return <span className="h-7" />;
  const ratio = width / Math.max(1, height);
  const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
  return (
    <span className="grid h-7 w-9 place-items-center">
      <span className="border-2 border-current" style={{ width: boxWidth, height: boxHeight }} />
    </span>
  );
}

function SettingTitle({ children }: { children: string }) {
  return <div className="text-xs font-medium text-stone-500">{children}</div>;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="absolute inset-x-1 bottom-1 flex justify-between">
      <button className="order-button" disabled={index <= 0} onClick={() => onMove(-1)}>
        <ArrowLeft size={12} />
      </button>
      <button className="order-button" disabled={index >= total - 1} onClick={() => onMove(1)}>
        <ArrowRight size={12} />
      </button>
    </div>
  );
}

function buildLog({
  prompt,
  model,
  config,
  references,
  durationMs,
  successCount,
  failCount,
  status,
  images,
}: {
  prompt: string;
  model: string;
  config: AiConfig;
  references: ReferenceImage[];
  durationMs: number;
  successCount: number;
  failCount: number;
  status: GenerationLog["status"];
  images: GeneratedImage[];
}): GenerationLog {
  const logConfig = {
    model: config.model,
    imageModel: config.imageModel,
    quality: config.quality,
    size: config.size,
    count: config.count,
  };
  return {
    id: createId("log"),
    createdAt: Date.now(),
    title: prompt.slice(0, 12) || "未命名",
    prompt,
    time: new Date().toLocaleString("zh-CN", { hour12: false }),
    model,
    config: logConfig,
    references,
    durationMs,
    successCount,
    failCount,
    imageCount: Number(logConfig.count) || successCount,
    size: logConfig.size,
    quality: logConfig.quality,
    status,
    images,
    thumbnails: images.map((image) => image.dataUrl).filter(Boolean).slice(0, 4),
  };
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
  return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function replaceImageAt(images: GeneratedImage[], index: number, image: GeneratedImage) {
  const next = [...images];
  next[index] = image;
  return next.filter(Boolean);
}

function moveListItem<T>(items: T[], index: number, offset: number) {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
  const match = size?.match(/^(\d+)x(\d+)$/);
  return {
    width: match ? Number(match[1]) : fallback.width,
    height: match ? Number(match[2]) : fallback.height,
  };
}

function alignDimension(value: number) {
  return Math.ceil(value / 16) * 16;
}
