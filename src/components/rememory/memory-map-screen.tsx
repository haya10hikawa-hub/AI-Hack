"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Compass,
  LocateFixed,
  Map as MapIcon,
  MapPinOff,
  Navigation,
  RotateCcw,
} from "lucide-react";
import { cellToLocalIj, gridDisk } from "h3-js";

import {
  coordinatesToMemoryMapCell,
  isAllowedMemoryMapCell,
} from "@/src/domain/memory-map";

import { apiRequest, jsonBody } from "./api-client";
import { AppShell } from "./app-shell";
import { InlineNotice, StateView } from "./state-view";
import type { MemoryMapCell, MemoryMapPayload } from "./types";
import { useApiResource } from "./use-api-resource";

const stateLabel = {
  passed: "通った地域",
  experienced: "体験がある地域",
  memory: "Memoryがある地域",
} as const;

function FogGrid({
  cells,
  selectedCellId,
  recentlyRevealedCellId,
  onSelect,
}: {
  cells: MemoryMapCell[];
  selectedCellId: string | null;
  recentlyRevealedCellId: string | null;
  onSelect: (cellId: string) => void;
}) {
  const focus = selectedCellId ?? cells[0]?.cellId ?? null;
  const tiles = useMemo(() => {
    if (!focus) return [];
    const origin = cellToLocalIj(focus, focus);
    const byId = new Map(cells.map((cell) => [cell.cellId, cell]));
    return gridDisk(focus, 3).map((cellId) => {
      const coordinate = cellToLocalIj(focus, cellId);
      const q = coordinate.i - origin.i;
      const r = coordinate.j - origin.j;
      return {
        cellId,
        cell: byId.get(cellId) ?? null,
        x: 50 + (q - r) * 7,
        y: 50 + (q + r) * 5.2,
      };
    });
  }, [cells, focus]);

  if (!focus) {
    return (
      <div className="memory-map-blank" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <div
      className="memory-fog-grid"
      role="group"
      aria-label="探索した地域の地図。下の地域一覧からも同じ情報を操作できます。"
    >
      {tiles.map(({ cellId, cell, x, y }) => {
        const label = cell
          ? `${cell.coarsePlace ?? stateLabel[cell.state]}、${stateLabel[cell.state]}、訪問${cell.visitCount}回`
          : "まだひらかれていない地域";
        return (
          <button
            key={cellId}
            type="button"
            className={`fog-cell fog-cell--${cell?.state ?? "unknown"}${selectedCellId === cellId ? " is-selected" : ""}${recentlyRevealedCellId === cellId ? " is-revealing" : ""}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            disabled={!cell}
            aria-label={label}
            aria-pressed={cell ? selectedCellId === cellId : undefined}
            onClick={() => cell && onSelect(cellId)}
          >
            {cell?.state === "memory" ? (
              <span className="fog-cell__node" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
      <div className="map-compass" aria-hidden="true">
        <Compass size={18} />
        <span>記憶の北</span>
      </div>
    </div>
  );
}

export function MemoryMapScreen() {
  const resource = useApiResource<MemoryMapPayload>("/api/map");
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [permissionState, setPermissionState] = useState<
    "idle" | "denied" | "unavailable" | "timeout" | "unsupported" | "revealed"
  >("idle");
  const [recentlyRevealedCellId, setRecentlyRevealedCellId] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState<{
    tone: "sage" | "coral" | "error";
    text: string;
  } | null>(null);
  const [clearing, setClearing] = useState(false);
  const data = resource.data;
  const selectedCell =
    data?.cells.find((cell) => cell.cellId === selectedCellId) ??
    data?.cells[0] ??
    null;
  const unauthenticated = resource.error?.status === 401;

  useEffect(() => {
    if (!data?.cells.length) return;
    const requestedCell = new URLSearchParams(window.location.search).get(
      "cellId",
    );
    if (
      requestedCell !== null &&
      isAllowedMemoryMapCell(requestedCell) &&
      data.cells.some(({ cellId }) => cellId === requestedCell)
    ) {
      queueMicrotask(() => setSelectedCellId(requestedCell));
    }
  }, [data?.cells]);

  useEffect(() => {
    if (
      recentlyRevealedCellId === null ||
      !data?.cells.some((cell) => cell.cellId === recentlyRevealedCellId)
    ) {
      return;
    }
    const timer = window.setTimeout(() => setRecentlyRevealedCellId(null), 700);
    return () => window.clearTimeout(timer);
  }, [data?.cells, recentlyRevealedCellId]);

  const enableMap = async () => {
    setEnabling(true);
    setMessage(null);
    try {
      await apiRequest("/api/settings/privacy-ai", {
        method: "PATCH",
        ...jsonBody({ memoryMap: true }),
      });
      setMessage({ tone: "sage", text: "Memory Mapを有効にしました。" });
      resource.reload();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "設定を保存できませんでした。",
      });
    } finally {
      setEnabling(false);
    }
  };

  const revealCurrentCell = () => {
    setMessage(null);
    if (!("geolocation" in navigator)) {
      setPermissionState("unsupported");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Exact coordinates live only in this callback. They are converted to
        // one H3 cell immediately and are never copied into React state or logs.
        let cellId: string;
        try {
          cellId = coordinatesToMemoryMapCell(
            position.coords.latitude,
            position.coords.longitude,
          );
        } catch (caught) {
          setMessage({
            tone: "error",
            text:
              caught instanceof Error
                ? caught.message
                : "地域をひらけませんでした。",
          });
          setLocating(false);
          return;
        }
        void apiRequest<{ revealed: boolean; cellId: string }>("/api/map", {
          method: "POST",
          ...jsonBody({ cellId }),
        })
          .then(() => {
            setSelectedCellId(cellId);
            setRecentlyRevealedCellId(cellId);
            setPermissionState("revealed");
            setMessage({
              tone: "sage",
              text: "現在いる地域をひらきました。正確な位置情報は保存していません。",
            });
            resource.reload();
          })
          .catch((caught: unknown) => {
            setMessage({
              tone: "error",
              text:
                caught instanceof Error
                  ? caught.message
                  : "地域をひらけませんでした。",
            });
          })
          .finally(() => setLocating(false));
      },
      (error) => {
        setPermissionState(
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable",
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const clearMap = async () => {
    setClearing(true);
    setMessage(null);
    try {
      await apiRequest("/api/map", { method: "DELETE" });
      setSelectedCellId(null);
      setMessage({
        tone: "sage",
        text: "探索した地図を消去しました。Memoryは削除されていません。",
      });
      resource.reload();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "地図を消去できませんでした。",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <AppShell>
      <div className="page-shell page-shell--map">
        <header className="page-intro map-intro">
          <div>
            <p className="eyebrow">Memory Exploration Map</p>
            <h1>生きた場所だけ、世界がひらく。</h1>
            <p>
              正確な移動履歴ではなく、あなたのEvidenceがある地域だけを静かに描きます。
            </p>
          </div>
        </header>

        {message ? (
          <InlineNotice tone={message.tone}>{message.text}</InlineNotice>
        ) : null}
        {resource.loading ? (
          <StateView
            kind="loading"
            title="記憶の地図を読み込んでいます"
            description="保存された地域セルとMemoryの関係を確認しています。"
          />
        ) : resource.error && !unauthenticated ? (
          <StateView
            kind={resource.error.code === "NETWORK_ERROR" ? "offline" : "error"}
            title="地図を読み込めませんでした"
            description={resource.error.message}
            action={
              <button
                className="button button--secondary"
                onClick={resource.reload}
              >
                もう一度読み込む
              </button>
            }
          />
        ) : unauthenticated ? (
          <StateView
            kind="empty"
            title="公開プレビューでは地図はまだ空です"
            description="ログインなしで使えます。写真の場所Evidenceや現在地の同意からMemory Mapが開きます。"
            action={
              <Link className="button button--primary" href="/home">
                Memory Threadへ戻る
              </Link>
            }
          />
        ) : data ? (
          <>
            {permissionState === "denied" ? (
              <InlineNotice tone="coral">
                位置情報は許可されていません。保存済みの地域とMemoryはそのまま見られます。ブラウザ設定を変更後、もう一度お試しください。
              </InlineNotice>
            ) : permissionState === "unavailable" ? (
              <InlineNotice tone="coral">
                現在地を取得できませんでした。保存済みの地図を見ながら、通信状態のよい場所でもう一度お試しください。
              </InlineNotice>
            ) : permissionState === "timeout" ? (
              <InlineNotice tone="coral">
                現在地の取得に時間がかかっています。保存済みの地図はそのまま利用できます。もう一度お試しください。
              </InlineNotice>
            ) : permissionState === "unsupported" ? (
              <InlineNotice tone="coral">
                このブラウザでは現在地を利用できません。保存済みの地図と地域一覧をご利用ください。
              </InlineNotice>
            ) : null}

            <div className="map-hero-layout">
              <section
                className="memory-map-stage"
                aria-labelledby="map-stage-title"
              >
                <div className="map-stage-heading">
                  <div>
                    <p className="eyebrow">Fog of Memory</p>
                    <h2 id="map-stage-title">あなたの世界</h2>
                  </div>
                  <dl className="map-legend" aria-label="地図の状態">
                    <div>
                      <dt className="legend-swatch legend-swatch--unknown" />
                      <dd>未探索</dd>
                    </div>
                    <div>
                      <dt className="legend-swatch legend-swatch--passed" />
                      <dd>通過</dd>
                    </div>
                    <div>
                      <dt className="legend-swatch legend-swatch--experienced" />
                      <dd>体験</dd>
                    </div>
                    <div>
                      <dt className="legend-swatch legend-swatch--memory" />
                      <dd>Memory</dd>
                    </div>
                  </dl>
                </div>
                <FogGrid
                  cells={data.cells}
                  selectedCellId={selectedCell?.cellId ?? null}
                  recentlyRevealedCellId={recentlyRevealedCellId}
                  onSelect={setSelectedCellId}
                />
                {data.cells.length === 0 ? (
                  <div className="map-empty-copy">
                    <MapPinOff aria-hidden="true" size={22} />
                    <div>
                      <h3>まだ地図に記憶がありません</h3>
                      <span>
                        現在地を使うと、最初の地域が静かにひらきます。
                      </span>
                    </div>
                  </div>
                ) : null}
              </section>

              <aside className="map-hero-panel" aria-label="地域の操作と詳細">
                <section
                  className="map-privacy-gate"
                  aria-labelledby="map-location-title"
                >
                  <div>
                    <LocateFixed aria-hidden="true" size={24} />
                    <div>
                      <h2 id="map-location-title">現在地からひらく</h2>
                      <p>
                        正確な位置情報は保存しません。端末内で約150mの粗い地域単位へ変換して最小化します。
                      </p>
                    </div>
                  </div>
                  {data.enabled ? (
                    <button
                      className="button button--primary map-location-cta"
                      type="button"
                      disabled={locating}
                      onClick={revealCurrentCell}
                    >
                      <Navigation aria-hidden="true" size={18} />
                      {locating ? "地域へ変換中…" : "現在地を使う"}
                    </button>
                  ) : (
                    <button
                      className="button button--primary map-location-cta"
                      type="button"
                      disabled={enabling}
                      onClick={() => void enableMap()}
                    >
                      {enabling ? "有効化中…" : "Memory Mapを有効にする"}
                    </button>
                  )}
                </section>

                {selectedCell ? (
                  <section
                    className="map-cell-detail"
                    aria-labelledby="selected-area-title"
                  >
                    <div className="map-cell-detail__heading">
                      <span
                        className={`area-state area-state--${selectedCell.state}`}
                      >
                        {stateLabel[selectedCell.state]}
                      </span>
                      <h2 id="selected-area-title">
                        {selectedCell.coarsePlace ?? "ひらいた地域"}
                      </h2>
                      <p>
                        {selectedCell.visitCount}回の訪問 ·{" "}
                        {selectedCell.memoryCount}件のMemory
                      </p>
                    </div>
                    <Link
                      className="button button--primary map-recall-cta"
                      href={`/search?q=${encodeURIComponent("この辺で何してた？")}&cellId=${encodeURIComponent(selectedCell.cellId)}`}
                    >
                      この辺の記憶を探す
                    </Link>
                    {selectedCell.memories.length > 0 ? (
                      <ul className="map-memory-list">
                        {selectedCell.memories.map((memory) => (
                          <li key={memory.id}>
                            <Link
                              href={`/memories/${encodeURIComponent(memory.id)}`}
                            >
                              <span>
                                <small>Memoryを見る</small>
                                <strong>{memory.title}</strong>
                              </span>
                              <ArrowRight aria-hidden="true" size={18} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted-copy">
                        この地域には、まだ根拠を持つactive
                        Memoryが紐づいていません。
                      </p>
                    )}
                  </section>
                ) : (
                  <section className="map-cell-detail map-cell-detail--empty">
                    <p className="eyebrow">Place to Recall</p>
                    <h2>地域を選ぶ</h2>
                    <p>
                      ひらいた地域を選ぶと、訪問回数とその場所のMemoryを確認できます。
                    </p>
                  </section>
                )}
              </aside>
            </div>

            {data.partial ? (
              <InlineNotice tone="coral">{data.partialMessage}</InlineNotice>
            ) : null}

            <section
              className="coarse-area-section"
              aria-labelledby="coarse-area-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Accessible list</p>
                  <h2 id="coarse-area-title">Memoryがある地域</h2>
                </div>
              </div>
              {data.coarseAreas.length > 0 ? (
                <ul className="coarse-area-list">
                  {data.coarseAreas.map((area) => (
                    <li key={area.coarsePlace}>
                      <div>
                        <MapIcon aria-hidden="true" size={20} />
                        <span>
                          <strong>{area.coarsePlace}</strong>
                          <small>{area.memories.length}件のMemory</small>
                        </span>
                      </div>
                      <ul>
                        {area.memories.slice(0, 3).map((memory) => (
                          <li key={memory.id}>
                            <Link href={`/memories/${memory.id}`}>
                              {memory.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">
                  場所のEvidenceがあるMemoryはまだありません。
                </p>
              )}
            </section>

            <div className="map-clear-action">
              <div>
                <RotateCcw aria-hidden="true" size={20} />
                <p>
                  <strong>探索した地図を消去</strong>
                  <span>Memoryや写真は削除されません。</span>
                </p>
              </div>
              <button
                className="button button--quiet button--danger-text"
                type="button"
                disabled={clearing || data.cells.length === 0}
                onClick={() => void clearMap()}
              >
                {clearing ? "消去中…" : "地図だけ消去"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
