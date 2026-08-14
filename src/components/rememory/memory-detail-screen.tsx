"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Image as ImageIcon,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { AppShell } from "./app-shell";
import { apiRequest, ApiError, jsonBody } from "./api-client";
import { InlineNotice, StateView } from "./state-view";
import type {
  ClaimItem,
  EpistemicState,
  EvidenceItem,
  MemoryDetailPayload,
} from "./types";
import { useApiResource } from "./use-api-resource";

function formatDate(value: string | null): string {
  if (!value) return "日時は未確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時は未確認";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function stateLabel(state: EpistemicState): string {
  switch (state) {
    case "confirmed":
      return "あなたが確認済み";
    case "evidence":
      return "Evidenceから確認";
    case "inferred":
      return "AIによる推定";
    case "disputed":
      return "確認内容に相違あり";
    default:
      return "未確認";
  }
}

function claimOriginLabel(claim: ClaimItem): string {
  if (claim.origin === "user") return "あなたの確認";
  if (claim.origin === "deterministic") return "メタデータから確認";
  return "AIによる推定";
}

function evidenceKindLabel(evidence: EvidenceItem): string {
  switch (evidence.kind) {
    case "photo":
      return "写真";
    case "metadata":
      return "メタデータ";
    case "user_correction":
      return "あなたの確認";
    case "related_memory":
      return "関連Memory";
    default:
      return "Evidence";
  }
}

export function MemoryDetailScreen() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const resource = useApiResource<MemoryDetailPayload>(
    id ? `/api/memories/${encodeURIComponent(id)}` : null,
  );
  const data = resource.data;
  const [deleteState, setDeleteState] = useState<
    "idle" | "confirming" | "deleting" | "deleted"
  >("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retryingAnalysis, setRetryingAnalysis] = useState(false);
  const [retryNotice, setRetryNotice] = useState<{
    tone: "sage" | "error";
    text: string;
  } | null>(null);

  async function retryAnalysis() {
    if (!id || retryingAnalysis) return;
    setRetryingAnalysis(true);
    setRetryNotice(null);
    try {
      const result = await apiRequest<{ retryRequested: number }>(
        "/api/analysis/retry",
        {
          method: "POST",
          ...jsonBody({ memoryId: id }),
        },
      );
      setRetryNotice({
        tone: "sage",
        text:
          result.retryRequested > 0
            ? "AI再構成を再開しました。"
            : "再試行できる解析はありませんでした。状態を更新します。",
      });
      resource.reload();
    } catch (error) {
      setRetryNotice({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "AI再構成を再開できませんでした。",
      });
    } finally {
      setRetryingAnalysis(false);
    }
  }

  async function deleteMemory() {
    if (!id || deleteState === "deleting") return;
    setDeleteState("deleting");
    setDeleteError(null);
    try {
      await apiRequest(`/api/memories/${encodeURIComponent(id)}/delete`, {
        method: "POST",
      });
      setDeleteState("deleted");
    } catch (error) {
      setDeleteState("confirming");
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : "削除を完了できませんでした。通信状態を確認して、もう一度試してください。",
      );
    }
  }

  return (
    <AppShell>
      <div className="page-shell page-shell--detail">
        <Link className="back-link" href="/home">
          <ArrowLeft aria-hidden="true" size={18} />
          Memory Threadへ
        </Link>

        {!id ? (
          <StateView
            kind="error"
            title="Memoryを開けません"
            description="Memoryの識別子が見つかりませんでした。"
          />
        ) : resource.loading ? (
          <StateView
            kind="loading"
            title="Memoryを読み込んでいます"
            description="写真、確認状態、Evidenceを取得しています。"
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
        ) : deleteState === "deleted" ? (
          <StateView
            kind="empty"
            title="Memoryを削除しました"
            description="元画像、派生画像、Evidence、Claimを含むこのMemoryのデータを削除しました。"
            action={
              <Link className="button button--primary" href="/home">
                Memory Threadへ戻る
              </Link>
            }
          />
        ) : data?.memory ? (
          <article className="memory-detail">
            <header className="memory-detail__hero">
              {data.memory.representativeImageUrl ? (
                <Image
                  src={data.memory.representativeImageUrl}
                  alt={
                    data.memory.representativeImageAlt ||
                    data.memory.title ||
                    "Memoryの代表写真"
                  }
                  width={1200}
                  height={900}
                  unoptimized
                />
              ) : (
                <div className="memory-detail__no-image">
                  <ImageIcon aria-hidden="true" size={30} />
                  <span>表示できる代表写真はありません</span>
                </div>
              )}
              <div className="memory-detail__identity">
                <span
                  className={`truth-label truth-label--${data.memory.state}`}
                >
                  <span
                    className={
                      data.memory.state === "inferred" ||
                      data.memory.state === "unknown"
                        ? "truth-label__node truth-label__node--open"
                        : "truth-label__node"
                    }
                    aria-hidden="true"
                  />
                  {stateLabel(data.memory.state)}
                </span>
                <h1>{data.memory.title || "タイトル未設定の記憶"}</h1>
                <dl className="memory-facts">
                  <div>
                    <dt>
                      <CalendarDays aria-hidden="true" size={17} />
                      日時
                    </dt>
                    <dd>{formatDate(data.memory.capturedAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      <MapPin aria-hidden="true" size={17} />
                      場所
                    </dt>
                    <dd>
                      {data.memory.placeLabel || "未確認"}
                      <small>
                        {stateLabel(data.memory.placeState ?? "unknown")}
                      </small>
                      {data.memory.place?.area ? (
                        <small>{data.memory.place.area}</small>
                      ) : null}
                      {data.memory.place?.category ? (
                        <small>{data.memory.place.category}</small>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <ImageIcon aria-hidden="true" size={17} />
                      写真
                    </dt>
                    <dd>
                      {data.memory.photoCount > 0
                        ? `${data.memory.photoCount}枚`
                        : "なし"}
                    </dd>
                  </div>
                </dl>
                {data.memory.place?.mapCellId ? (
                  <Link
                    className="memory-place-map-link"
                    href={`/map?cellId=${encodeURIComponent(data.memory.place.mapCellId)}`}
                  >
                    <MapPin aria-hidden="true" size={17} />
                    Memory Mapでこの場所を見る
                  </Link>
                ) : null}
                {data.memory.description ? (
                  <p className="memory-detail__description">
                    {data.memory.description}
                  </p>
                ) : null}
              </div>
            </header>

            {data.partial ? (
              <InlineNotice tone="coral">
                {data.partialMessage ||
                  "写真と確定情報は保存済みですが、AI再構成の一部はまだ完了していません。"}
              </InlineNotice>
            ) : null}

            {data.memory.processingState === "failed" ? (
              <div className="analysis-retry-action">
                <div>
                  <strong>途中結果から再開できます</strong>
                  <p>保存済みの写真をもう一度選ぶ必要はありません。</p>
                </div>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={retryingAnalysis}
                  onClick={() => void retryAnalysis()}
                >
                  {retryingAnalysis ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <RefreshCw aria-hidden="true" size={18} />
                  )}
                  {retryingAnalysis ? "再開しています…" : "AI再構成を再試行"}
                </button>
              </div>
            ) : null}

            {retryNotice ? (
              <InlineNotice tone={retryNotice.tone}>
                {retryNotice.text}
              </InlineNotice>
            ) : null}

            <section
              className="reconstruction-section"
              aria-labelledby="reconstruction-title"
            >
              <div className="layer-marker" aria-hidden="true">
                <span className="thread-node thread-node--open" />
                <span className="thread-line thread-line--dotted" />
              </div>
              <div>
                <p className="eyebrow">AI reconstruction · 未確認</p>
                <h2 id="reconstruction-title">AIが写真から読み取ったこと</h2>
                {data.reconstruction ? (
                  <p>{data.reconstruction}</p>
                ) : (
                  <p className="muted-copy">
                    表示できるAI再構成はありません。AIが分からない内容は追加しません。
                  </p>
                )}
                {data.claims.length > 0 ? (
                  <ul className="claim-list">
                    {data.claims.map((claim) => (
                      <li key={claim.id}>
                        <span
                          className={
                            claim.state === "inferred" ||
                            claim.state === "unknown"
                              ? "truth-label__node truth-label__node--open"
                              : "truth-label__node"
                          }
                          aria-hidden="true"
                        />
                        <span>
                          <strong>{claim.text}</strong>
                          <small>
                            {claimOriginLabel(claim)} ·{" "}
                            {stateLabel(claim.state)}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>

            <details className="evidence-section">
              <summary>
                <span>
                  <span className="eyebrow">Provenance</span>
                  <strong>このMemoryの根拠</strong>
                  <small>{data.evidence.length}件のEvidence</small>
                </span>
                <ChevronDown aria-hidden="true" size={20} />
              </summary>
              {data.evidence.length > 0 ? (
                <ol className="evidence-list">
                  {data.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <span
                        className="evidence-list__node"
                        aria-hidden="true"
                      />
                      {evidence.imageUrl ? (
                        <Image
                          src={evidence.imageUrl}
                          alt={evidence.label || "Evidence画像"}
                          width={124}
                          height={108}
                          unoptimized
                        />
                      ) : null}
                      <span>
                        <small>{evidenceKindLabel(evidence)}</small>
                        <strong>{evidence.label}</strong>
                        {evidence.detail ? <p>{evidence.detail}</p> : null}
                        {evidence.sourceLabel ? (
                          <em>出典: {evidence.sourceLabel}</em>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-copy evidence-section__empty">
                  表示できるEvidenceはありません。
                </p>
              )}
            </details>

            {data.memory.hasOpenGap ? (
              <aside className="detail-confirmation-entry">
                <span
                  className="thread-node thread-node--open"
                  aria-hidden="true"
                />
                <div>
                  <strong>まだ確認できていない文脈があります</strong>
                  <p>
                    質問はひとつだけ。答えないままMemoryを見ることもできます。
                  </p>
                </div>
                <Link className="button button--coral" href="/confirm">
                  確認する
                </Link>
              </aside>
            ) : null}

            <section
              className="memory-delete"
              aria-labelledby="memory-delete-title"
            >
              <div>
                <h2 id="memory-delete-title">このMemoryを削除</h2>
                <p>
                  元画像、AI用の派生画像、Evidence、Claimも削除します。この操作は元に戻せません。
                </p>
              </div>
              {deleteState === "confirming" ? (
                <div className="memory-delete__confirmation">
                  <strong>本当に削除しますか？</strong>
                  <div className="button-row">
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => {
                        setDeleteState("idle");
                        setDeleteError(null);
                      }}
                    >
                      やめる
                    </button>
                    <button
                      className="button button--danger"
                      type="button"
                      onClick={() => void deleteMemory()}
                    >
                      完全に削除
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="button button--quiet button--danger-text"
                  type="button"
                  disabled={deleteState === "deleting"}
                  onClick={() => setDeleteState("confirming")}
                >
                  <Trash2 aria-hidden="true" size={18} />
                  {deleteState === "deleting" ? "削除しています…" : "削除する"}
                </button>
              )}
              {deleteError ? (
                <p className="memory-delete__error" role="alert">
                  {deleteError}
                </p>
              ) : null}
            </section>
          </article>
        ) : (
          <StateView
            kind="empty"
            title="Memoryが見つかりません"
            description="削除されたか、表示する権限がない可能性があります。"
          />
        )}
      </div>
    </AppShell>
  );
}
