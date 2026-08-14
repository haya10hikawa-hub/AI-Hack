"use client";

import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  FileImage,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";

import { apiRequest, ApiError } from "./api-client";
import { AppShell } from "./app-shell";
import { uploadPhotoToSignedSlot } from "./direct-photo-upload";
import { InlineNotice } from "./state-view";
import type { UploadPayload } from "./types";
import { useConnectivity } from "./use-api-resource";

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const maximumFileBytes = 15 * 1024 * 1024;

interface LocalFile {
  key: string;
  file: File;
  error: string | null;
}

interface PreparedUpload {
  manifest: string;
  uploads: Array<{
    clientIndex: number;
    slotId: string;
    path: string;
    token: string;
  }>;
}

function toLocalFile(file: File): LocalFile {
  const supported = supportedTypes.has(file.type.toLowerCase());
  return {
    key: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    error: !supported
      ? "JPEG・PNG・WebP以外の画像形式には対応していません。"
      : file.size <= 0
        ? "空のファイルは追加できません。"
        : file.size > maximumFileBytes
          ? "1ファイル15MB以下にしてください。"
          : null,
  };
}

export function UploadScreen() {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coarsePlace, setCoarsePlace] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    phase: "uploading" | "processing";
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const online = useConnectivity();

  const addFiles = (selected: File[]) => {
    setResult(null);
    setError(null);
    setFiles((current) => {
      const known = new Set(current.map((item) => item.key));
      return [
        ...current,
        ...selected.map(toLocalFile).filter((item) => !known.has(item.key)),
      ];
    });
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validFiles = files.filter((item) => !item.error);
    if (validFiles.length === 0) {
      setError("アップロードできる写真を1枚以上選んでください。");
      return;
    }
    if (!online) {
      setError(
        "オフラインではアップロードを開始できません。再接続後にお試しください。",
      );
      return;
    }

    setSubmitting(true);
    setUploadProgress({
      completed: 0,
      total: validFiles.length,
      phase: "uploading",
    });
    setError(null);
    setResult(null);
    try {
      const prepared = await apiRequest<PreparedUpload>("/api/upload/prepare", {
        method: "POST",
        body: JSON.stringify({
          files: validFiles.map(({ file }) => ({
            name: file.name,
            mimeType: file.type,
            bytes: file.size,
          })),
        }),
      });
      if (prepared.uploads.length !== validFiles.length) {
        throw new Error("写真アップロードの準備結果が一致しませんでした。");
      }
      const localKeyBySlot = new Map(
        prepared.uploads.map((slot) => [
          slot.slotId,
          validFiles[slot.clientIndex]?.key ?? "",
        ]),
      );
      await runWithConcurrency(prepared.uploads, 3, async (slot) => {
        const local = validFiles[slot.clientIndex];
        if (local === undefined) {
          throw new Error("写真アップロードの対応関係が壊れています。");
        }
        try {
          await uploadPhotoToSignedSlot({
            path: slot.path,
            token: slot.token,
            file: local.file,
          });
        } catch {
          // The completion endpoint verifies every signed slot directly. A
          // lost browser response can still represent a successful upload, so
          // let the server make the authoritative accepted/rejected decision.
        } finally {
          setUploadProgress((current) =>
            current === null
              ? null
              : {
                  ...current,
                  completed: Math.min(current.total, current.completed + 1),
                },
          );
        }
      });
      setUploadProgress({
        completed: validFiles.length,
        total: validFiles.length,
        phase: "processing",
      });
      const payload = await apiRequest<UploadPayload>("/api/upload/complete", {
        method: "POST",
        body: JSON.stringify({
          manifest: prepared.manifest,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
          coarsePlace: coarsePlace.trim() || null,
        }),
      });
      setResult(payload);
      if (payload.accepted.length > 0) {
        setFiles((current) =>
          removeAcceptedFiles(current, payload, localKeyBySlot),
        );
        setCoarsePlace("");
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "公開セッションを確認できませんでした。ページを再読み込みしてから、もう一度お試しください。"
          : caught instanceof Error
            ? caught.message
            : "アップロードを完了できませんでした。",
      );
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <AppShell>
      <div className="page-shell page-shell--narrow">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Add evidence</p>
            <h1>写真からMemoryをつくる</h1>
            <p>
              まず日時などの確かな情報を読み取り、そのあと必要な写真だけを安全にAI解析します。
            </p>
          </div>
        </header>

        <form className="upload-workbench" onSubmit={upload}>
          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <ImagePlus aria-hidden="true" size={32} strokeWidth={1.6} />
            <h2>写真を選択</h2>
            <p>
              複数枚をまとめて選べます。ファイルの可否はサーバーでも再検証します。
            </p>
            <input
              ref={inputRef}
              id="photo-input"
              type="file"
              hidden
              tabIndex={-1}
              aria-hidden="true"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleInput}
            />
            <button
              className="button button--secondary"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              ファイルを開く
            </button>
          </div>

          {files.length > 0 ? (
            <section
              className="selected-files"
              aria-labelledby="selected-files-title"
            >
              <div className="section-heading section-heading--compact">
                <div>
                  <h2 id="selected-files-title">選択中の写真</h2>
                  <p>{files.length}件</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setFiles([])}
                >
                  すべて外す
                </button>
              </div>
              <ul className="file-list">
                {files.map((item) => (
                  <li
                    className={item.error ? "file-row has-error" : "file-row"}
                    key={item.key}
                  >
                    <FileImage aria-hidden="true" size={20} />
                    <span>
                      <strong>{item.file.name}</strong>
                      <small>
                        {item.error ||
                          `${Math.max(1, Math.round(item.file.size / 1024))} KB`}
                      </small>
                    </span>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`${item.file.name}を選択から外す`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((file) => file.key !== item.key),
                        )
                      }
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="upload-place-field">
            <label htmlFor="coarse-place">おおまかな場所（任意）</label>
            <input
              className="text-input"
              id="coarse-place"
              name="coarsePlace"
              type="text"
              maxLength={80}
              value={coarsePlace}
              onChange={(event) => setCoarsePlace(event.target.value)}
              placeholder="例: 神山"
              aria-describedby="coarse-place-hint"
            />
            <p className="field-hint" id="coarse-place-hint">
              市区町村など粗い名前だけを入力してください。今回の写真すべての場所として保存します。
            </p>
          </div>

          <div className="privacy-note">
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <strong>Privacy first</strong>
              <p>正確なGPS、元のファイル名、不要なEXIFは外部AIへ送りません。</p>
            </div>
          </div>

          {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
          {result ? (
            <InlineNotice
              tone={
                result.processingState === "failed" ||
                result.processingState === "partial"
                  ? "coral"
                  : "sage"
              }
            >
              <div className="upload-result">
                <strong>
                  {result.processingState === "processing"
                    ? "写真を保存しました。Memoryを再構成しています。"
                    : result.processingState === "partial" ||
                        result.processingState === "failed"
                      ? "写真は保存できましたが、再構成はまだ完了していません。"
                      : "写真を安全に保存しました。"}
                </strong>
                <span>
                  受付 {result.accepted.length}件
                  {result.rejected.length > 0
                    ? `・受付不可 ${result.rejected.length}件`
                    : ""}
                </span>
                {result.message ? <span>{result.message}</span> : null}
                {result.rejected.length > 0 ? (
                  <ul>
                    {result.rejected.map((item) => (
                      <li key={`${item.name}-${item.reason}`}>
                        {item.name}: {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Link className="inline-link" href="/home">
                  Memory Threadで状態を見る
                </Link>
              </div>
            </InlineNotice>
          ) : null}

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={
              submitting || !online || files.every((item) => item.error)
            }
          >
            {submitting ? (
              <LoaderCircle className="spin" aria-hidden="true" size={19} />
            ) : (
              <Check aria-hidden="true" size={19} />
            )}
            {submitting && uploadProgress?.phase === "uploading"
              ? `写真を送信中… ${uploadProgress.completed}/${uploadProgress.total}`
              : submitting
                ? "写真を検証してMemoryを作成中…"
                : "写真を安全に追加"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await task(items[index] as T);
      }
    },
  );
  await Promise.all(workers);
}

function removeAcceptedFiles(
  current: LocalFile[],
  payload: UploadPayload,
  localKeyBySlot: Map<string, string>,
): LocalFile[] {
  const acceptedKeys = new Set(
    payload.accepted
      .map(({ slotId }) =>
        slotId === undefined ? undefined : localKeyBySlot.get(slotId),
      )
      .filter((key): key is string => Boolean(key)),
  );
  const counts = new Map<string, number>();
  payload.accepted.forEach(({ name, slotId }) => {
    if (!name || (slotId !== undefined && localKeyBySlot.has(slotId))) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return current.filter((item) => {
    if (acceptedKeys.has(item.key)) return false;
    const normalized = normalizeFileName(item.file.name);
    const remaining = counts.get(normalized) ?? 0;
    if (remaining <= 0) return true;
    counts.set(normalized, remaining - 1);
    return false;
  });
}

function normalizeFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "_")
    .trim();
  return (normalized || "photo").slice(0, 180);
}
