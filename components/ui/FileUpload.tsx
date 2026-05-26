"use client";

import * as React from "react";
import { UploadCloud, FileText, X, Loader2, CheckCircle2 } from "lucide-react";
import { cn, formatBytes, shortHash } from "@/lib/utils";
import { sha256File } from "@/lib/hash";
import { useT } from "@/lib/i18n/context";
import type { FileRef } from "@/types/passport";

interface FileUploadProps {
  label?: string;
  hint?: string;
  accept?: string;
  maxSize?: number;
  value?: FileRef | null;
  onChange?: (file: FileRef | null) => void;
  onRawFile?: (file: File) => Promise<void> | void;
  uploadEndpoint?: string;
  disabled?: boolean;
  error?: string;
}

export function FileUpload({
  label,
  hint,
  accept = ".json,.csv,.pdf,.xml,.txt",
  maxSize = 10 * 1024 * 1024,
  value,
  onChange,
  onRawFile,
  uploadEndpoint = "/api/files/upload",
  disabled,
  error,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [progress, setProgress] = React.useState<"idle" | "hashing" | "uploading" | "done" | "error">(
    value ? "done" : "idle",
  );
  const [localError, setLocalError] = React.useState<string | null>(null);
  const t = useT();

  React.useEffect(() => {
    setProgress(value ? "done" : "idle");
  }, [value]);

  async function handleFiles(files: FileList | null) {
    setLocalError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;

    if (file.size > maxSize) {
      setLocalError(t.upload.tooLarge.replace("{size}", formatBytes(maxSize)));
      setProgress("error");
      return;
    }

    try {
      setProgress("hashing");
      const sha256 = await sha256File(file);

      if (onRawFile) await onRawFile(file);

      setProgress("uploading");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sha256", sha256);

      const res = await fetch(uploadEndpoint, { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Upload failed with ${res.status}`);
      }
      const data = (await res.json()) as { url: string };

      const ref: FileRef = {
        url: data.url,
        sha256,
        size: file.size,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      };
      onChange?.(ref);
      setProgress("done");
    } catch (e) {
      console.error(e);
      setLocalError(e instanceof Error ? e.message : t.upload.errorFallback);
      setProgress("error");
    }
  }

  function clear() {
    onChange?.(null);
    setProgress("idle");
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const displayError = error ?? localError;
  const busy = progress === "hashing" || progress === "uploading";

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</span>
      )}

      {value && progress === "done" ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-brand-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-ink-muted flex-shrink-0" />
                <span className="text-sm font-medium text-ink truncate">{value.filename}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{formatBytes(value.size)}</span>
                <span className="hash-mono">SHA-256: {shortHash(value.sha256, 6, 6)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="flex-shrink-0 text-ink-subtle hover:text-danger transition-colors"
              aria-label={t.upload.removeAria}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (disabled) return;
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 transition-colors cursor-pointer text-center",
            dragOver
              ? "border-brand-500 bg-brand-50"
              : "border-border bg-surface hover:border-brand-400 hover:bg-surface-2",
            disabled && "opacity-50 cursor-not-allowed pointer-events-none",
            displayError && "border-danger bg-rose-50/40",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            disabled={disabled || busy}
            onChange={(e) => handleFiles(e.target.files)}
            className="sr-only"
          />
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 text-brand-600 animate-spin" />
              <p className="text-sm text-ink">
                {progress === "hashing" ? t.upload.computing : t.upload.uploading}
              </p>
            </>
          ) : (
            <>
              <UploadCloud className="h-6 w-6 text-ink-subtle" />
              <p className="text-sm text-ink">
                <span className="font-medium text-brand-700">{t.upload.dropClick}</span>
                {t.upload.dropSuffix}
              </p>
              {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
            </>
          )}
        </label>
      )}

      {displayError && <p className="text-xs text-danger">{displayError}</p>}
    </div>
  );
}
