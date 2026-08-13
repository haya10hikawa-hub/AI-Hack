"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Image as ImageIcon,
} from "lucide-react";

import type { EpistemicState, MemoryThreadItem } from "./types";

function formatDate(value: string | null): string {
  if (!value) return "日時は未確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時は未確認";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function stateLabel(state: EpistemicState): string {
  switch (state) {
    case "confirmed":
      return "あなたが確認済み";
    case "evidence":
      return "Evidenceあり";
    case "inferred":
      return "AIによる推定";
    case "disputed":
      return "確認内容に相違あり";
    default:
      return "未確認";
  }
}

export function MemoryThread({ memories }: { memories: MemoryThreadItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(
    memories[0]?.id ?? null,
  );

  return (
    <ol className="memory-thread" aria-label="時間順のMemory Thread">
      {memories.map((memory, index) => {
        const expanded = expandedId === memory.id;
        const inferred =
          memory.state === "inferred" || memory.state === "unknown";
        const relationInferred = memory.relationState === "inferred";
        return (
          <li className="memory-thread__item" key={memory.id}>
            <div className="memory-thread__axis" aria-hidden="true">
              <span
                className={
                  inferred
                    ? "thread-node thread-node--open"
                    : "thread-node thread-node--filled"
                }
              />
              {index < memories.length - 1 ? (
                <span
                  className={
                    relationInferred
                      ? "thread-line thread-line--dotted"
                      : "thread-line"
                  }
                />
              ) : null}
            </div>
            <article
              className={`memory-entry${expanded ? " is-expanded" : ""}`}
            >
              <button
                className="memory-entry__toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={`memory-${memory.id}`}
                onClick={() => setExpandedId(expanded ? null : memory.id)}
              >
                <span className="memory-entry__date">
                  {formatDate(memory.capturedAt)}
                </span>
                <span className="memory-entry__title-row">
                  <strong>{memory.title || "タイトル未設定の記憶"}</strong>
                  {expanded ? (
                    <ChevronDown aria-hidden="true" size={20} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={20} />
                  )}
                </span>
                <span className="memory-entry__meta">
                  <span>{memory.placeLabel || "場所は未確認"}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {memory.photoCount > 0
                      ? `${memory.photoCount}枚の写真`
                      : "写真なし"}
                  </span>
                </span>
                {memory.processingState === "processing" ? (
                  <span className="processing-label">
                    写真を保存済み・AI再構成中
                  </span>
                ) : null}
                {memory.processingState === "partial" ||
                memory.processingState === "failed" ? (
                  <span className="processing-label processing-label--partial">
                    写真は保存済み・再構成は未完了
                  </span>
                ) : null}
              </button>

              <div
                className="memory-entry__expanded"
                id={`memory-${memory.id}`}
                hidden={!expanded}
              >
                {memory.representativeImageUrl ? (
                  <Image
                    className="memory-entry__image"
                    src={memory.representativeImageUrl}
                    alt={
                      memory.representativeImageAlt ||
                      memory.title ||
                      "Memoryの代表写真"
                    }
                    width={800}
                    height={600}
                    unoptimized
                  />
                ) : (
                  <div className="memory-entry__image-empty">
                    <ImageIcon aria-hidden="true" size={24} />
                    <span>表示できる代表写真はありません</span>
                  </div>
                )}
                <div className="memory-entry__details">
                  <span className={`truth-label truth-label--${memory.state}`}>
                    <span
                      className={
                        inferred
                          ? "truth-label__node truth-label__node--open"
                          : "truth-label__node"
                      }
                      aria-hidden="true"
                    />
                    {stateLabel(memory.state)}
                  </span>
                  {memory.summary ? (
                    <div
                      className={
                        inferred ? "ai-reconstruction" : "memory-summary"
                      }
                    >
                      {inferred ? <span>AIによる再構成</span> : null}
                      <p>{memory.summary}</p>
                    </div>
                  ) : (
                    <p className="muted-copy">
                      このMemoryには、まだ表示できる説明がありません。
                    </p>
                  )}
                  {memory.relationLabel ? (
                    <div
                      className={`relation-note relation-note--${memory.relationState ?? "inferred"}`}
                    >
                      <span aria-hidden="true" />
                      <p>{memory.relationLabel}</p>
                    </div>
                  ) : null}
                  <div className="memory-entry__actions">
                    <Link
                      className="button button--secondary button--small"
                      href={`/memories/${encodeURIComponent(memory.id)}`}
                    >
                      根拠を見る
                    </Link>
                    {memory.hasOpenGap ? (
                      <Link
                        className="button button--coral button--small"
                        href="/confirm"
                      >
                        <CircleHelp aria-hidden="true" size={17} />
                        ひとつ確認する
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
