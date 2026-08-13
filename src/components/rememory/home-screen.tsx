"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ImagePlus, Search } from "lucide-react";

import { AppShell } from "./app-shell";
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
  const data = normalizeThread(resource.data);
  const isProcessing =
    data?.memories.some(
      ({ processingState }) => processingState === "processing",
    ) ?? false;

  useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setTimeout(resource.reload, 4_000);
    return () => window.clearTimeout(timer);
  }, [isProcessing, resource.reload, resource.data]);

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

        {resource.loading ? (
          <StateView
            kind="loading"
            title="Memoryを読み込んでいます"
            description="保存済みの写真と確認状態を安全に取得しています。"
          />
        ) : resource.error ? (
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
            title="最初のMemoryをつくりましょう"
            description="写真を追加すると、日時など確かな情報から出来事のまとまりをつくります。AIが分からないことは、未確認のまま残します。"
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
