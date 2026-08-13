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

import { apiRequest } from "./api-client";
import { AppShell } from "./app-shell";
import { InlineNotice } from "./state-view";
import type { UploadPayload } from "./types";
import { useConnectivity } from "./use-api-resource";

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const maximumFileBytes = 20 * 1024 * 1024;

interface LocalFile {
  key: string;
  file: File;
  error: string | null;
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
          ? "1ファイル20MB以下にしてください。"
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

    const body = new FormData();
    validFiles.forEach(({ file }) => body.append("files", file, file.name));
    body.append(
      "timezoneOffsetMinutes",
      String(new Date().getTimezoneOffset()),
    );
    body.append(
      "timezone",
      Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
    );
    if (coarsePlace.trim()) body.append("coarsePlace", coarsePlace.trim());
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const payload = await apiRequest<UploadPayload>("/api/upload", {
        method: "POST",
        body,
      });
      setResult(payload);
      const acceptedNames = new Set(
        payload.accepted.map((item) => item.name).filter(Boolean),
      );
      if (acceptedNames.size > 0) {
        setFiles((current) =>
          current.filter((item) => !acceptedNames.has(item.file.name)),
        );
        setCoarsePlace("");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "アップロードを完了できませんでした。",
      );
    } finally {
      setSubmitting(false);
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
            {submitting ? "写真を検証して保存中…" : "写真を安全に追加"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
