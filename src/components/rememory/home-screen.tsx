"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";

import { AppShell } from "./app-shell";
import { apiRequest, jsonBody } from "./api-client";
import { MemoryThread } from "./memory-thread";
import { InlineNotice, StateView } from "./state-view";
import type { MemoryThreadItem, MemoryThreadPayload } from "./types";
import { useApiResource } from "./use-api-resource";

function normalizeThread(
  value: MemoryThreadPayload | MemoryThreadItem[] | null,
): MemoryThreadPayload | null {
  if (!value) return null;
  if (Array.isArray(value)) return { memories: value };
  return {
    ...value,
    memories: Array.isArray(value.memories) ? value.memories : [],
  };
}

export function HomeScreen() {
  const resource = useApiResource<MemoryThreadPayload | MemoryThreadItem[]>(
    "/api/memories?view=thread",
  );
  const reload = resource.reload;
  const data = normalizeThread(resource.data);
  const [retrying, setRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState<{
    tone: "sage" | "error";
    text: string;
  } | null>(null);
  const isProcessing =
    data?.memories.some(
      ({ processingState }) => processingState === "processing",
    ) ?? false;
  const hasFailed =
    data?.memories.some(
      ({ processingState }) => processingState === "failed",
    ) ?? false;
  const unauthenticated = resource.error?.status === 401;

  const retryFailedAnalysis = async () => {
    setRetrying(true);
    setRetryNotice(null);
    try {
      const result = await apiRequest<{ retryRequested: number }>(
        "/api/analysis/retry",
        { method: "POST", ...jsonBody({}) },
      );
      setRetryNotice({
        tone: "sage",
        text:
          result.retryRequested > 0
            ? "AI再構成を再開しました。進行状況は自動で更新されます。"
            : "再試行できる解析はありませんでした。現在の状態を更新します。",
      });
      reload();
    } catch (caught) {
      setRetryNotice({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "AI再構成を再開できませんでした。",
      });
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (!isProcessing) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void apiRequest("/api/analysis/process", { method: "POST" })
        .catch(() => undefined)
        .finally(() => {
          if (active) reload();
        });
    }, 4_000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isProcessing, reload, resource.data]);

  return (
    <AppShell>
      <div className="page-shell page-shell--thread">
        <header className="page-intro page-intro--thread">
          <div>
            <p className="eyebrow">Your living archive</p>
            <h1>Memory Thread</h1>
            <p>写真と、確認できたことを時間の流れで辿ります。</p>
          </div>
          <Link
            className="button button--primary page-intro__action"
            href="/add"
          >
            <ImagePlus aria-hidden="true" size={19} />
            写真を追加
          </Link>
        </header>

        {data?.pendingConfirmationCount ? (
          <Link className="confirmation-invitation" href="/confirm">
            <span className="confirmation-invitation__nodes" aria-hidden="true">
              <i />
              <b />
              <i />
            </span>
            <span>
              <strong>ひとつだけ確認したいことがあります</strong>
              <small>
                {data.pendingConfirmationCount}
                件のMemoryを、あなたの確認でつなげられます。
              </small>
            </span>
            <ArrowRight aria-hidden="true" size={20} />
          </Link>
        ) : null}

        {data?.partial ? (
          <InlineNotice tone="coral">
            {data.partialMessage ||
              "保存済みのMemoryを表示しています。一部のAI再構成はまだ完了していません。"}
          </InlineNotice>
        ) : null}

        {hasFailed ? (
          <div className="analysis-retry-action">
            <div>
              <strong>写真を再アップロードする必要はありません</strong>
              <p>保存済みの派生画像と途中結果から、安全に再開できます。</p>
            </div>
            <button
              className="button button--secondary"
              type="button"
              disabled={retrying}
              onClick={() => void retryFailedAnalysis()}
            >
              {retrying ? (
                <LoaderCircle className="spin" aria-hidden="true" size={18} />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {retrying ? "再開しています…" : "AI再構成を再試行"}
            </button>
          </div>
        ) : null}

        {retryNotice ? (
          <InlineNotice tone={retryNotice.tone}>
            {retryNotice.text}
          </InlineNotice>
        ) : null}

        {resource.loading ? (
          <StateView
            kind="loading"
            title="Memoryを読み込んでいます"
            description="保存済みの写真と確認状態を安全に取得しています。"
          />
        ) : resource.error && !unauthenticated ? (
          <StateView
            kind={resource.error.code === "NETWORK_ERROR" ? "offline" : "error"}
            title="Memoryを読み込めませんでした"
            description={resource.error.message}
            action={
              <button
                className="button button--secondary"
                type="button"
                onClick={resource.reload}
              >
                もう一度読み込む
              </button>
            }
          />
        ) : data && data.memories.length > 0 ? (
          <MemoryThread memories={data.memories} />
        ) : (
          <StateView
            kind="empty"
            title={
              unauthenticated
                ? "公開プレビューを表示しています"
                : "最初のMemoryをつくりましょう"
            }
            description={
              unauthenticated
                ? "ログインなしで使える公開セッションを準備しています。準備後、そのまま写真を保存できます。"
                : "写真を追加すると、日時など確かな情報から出来事のまとまりをつくります。AIが分からないことは、未確認のまま残します。"
            }
            action={
              <Link className="button button--primary" href="/add">
                <ImagePlus aria-hidden="true" size={19} />
                写真を選ぶ
              </Link>
            }
          />
        )}

        <aside className="recall-entry" aria-labelledby="recall-entry-title">
          <div>
            <p className="eyebrow">Recall</p>
            <h2 id="recall-entry-title">曖昧な言葉から、思い出す</h2>
            <p>
              時期や場所がはっきりしなくても大丈夫。根拠が一致したMemoryだけを探します。
            </p>
          </div>
          <Link className="button button--secondary" href="/search">
            <Search aria-hidden="true" size={18} />
            Memoryを検索
          </Link>
        </aside>
      </div>
    </AppShell>
  );
}
