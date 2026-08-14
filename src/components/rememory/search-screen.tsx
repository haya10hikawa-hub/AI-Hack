"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { apiRequest, jsonBody } from "./api-client";
import { AppShell } from "./app-shell";
import { InlineNotice, StateView } from "./state-view";
import type {
  SearchCandidate,
  SearchInterpretation,
  SearchPayload,
} from "./types";
import { useConnectivity } from "./use-api-resource";

function interpretationEntries(
  value: SearchInterpretation,
): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  if (value.time) entries.push({ label: "時期", value: value.time });
  if (value.place) entries.push({ label: "場所", value: value.place });
  if (value.people?.length)
    entries.push({ label: "人物", value: value.people.join("、") });
  if (value.activities?.length)
    entries.push({ label: "活動", value: value.activities.join("、") });
  if (value.keywords?.length)
    entries.push({ label: "内容", value: value.keywords.join("、") });
  return entries;
}

function formatCandidateDate(value: string | null): string {
  if (!value) return "日時未確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時未確認";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function SearchCandidateRow({ candidate }: { candidate: SearchCandidate }) {
  const { memory, matchReasons } = candidate;
  return (
    <li>
      <Link
        className="search-candidate"
        href={`/memories/${encodeURIComponent(memory.id)}`}
      >
        {memory.representativeImageUrl ? (
          <Image
            src={memory.representativeImageUrl}
            alt={
              memory.representativeImageAlt ||
              memory.title ||
              "Memoryの代表写真"
            }
            width={184}
            height={176}
            unoptimized
          />
        ) : (
          <div className="search-candidate__no-image">
            <ImageIcon aria-hidden="true" size={22} />
            <span className="visually-hidden">代表写真なし</span>
          </div>
        )}
        <span className="search-candidate__body">
          <small>
            {formatCandidateDate(memory.capturedAt)} ·{" "}
            {memory.placeLabel || "場所未確認"}
          </small>
          <strong>{memory.title || "タイトル未設定の記憶"}</strong>
          {matchReasons.length > 0 ? (
            <span className="match-reasons" aria-label="一致した理由">
              {matchReasons.map((reason) => (
                <i key={reason}>{reason}</i>
              ))}
            </span>
          ) : (
            <span className="muted-copy">一致理由はまだ取得できていません</span>
          )}
        </span>
        <ArrowRight aria-hidden="true" size={20} />
      </Link>
    </li>
  );
}

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState<SearchPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(
    null,
  );
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [mapCellId, setMapCellId] = useState<string | null>(null);
  const online = useConnectivity();

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const prefilled = parameters.get("q");
    const cellId = parameters.get("cellId");
    if (prefilled) {
      queueMicrotask(() => setQuery(prefilled.slice(0, 500)));
    }
    if (cellId) {
      queueMicrotask(() => setMapCellId(cellId.slice(0, 32)));
    }
  }, []);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError("思い出したいことを、短い言葉でもいいので入力してください。");
      return;
    }
    if (!online) {
      setError(
        "オフラインではMemoryを検索できません。再接続後にお試しください。",
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);
    setFeedback(null);
    setSubmittedQuery(trimmed);
    try {
      const payload = await apiRequest<SearchPayload>("/api/search", {
        method: "POST",
        ...jsonBody({
          query: trimmed,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
          currentDate: new Date().toLocaleDateString("sv-SE"),
          ...(mapCellId ? { cellId: mapCellId } : {}),
        }),
      });
      setResult({
        ...payload,
        interpretation: payload.interpretation ?? {},
        candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "検索を完了できませんでした。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const saveFeedback = async (outcome: "helpful" | "not_helpful") => {
    const memoryId = result?.candidates[0]?.memory.id;
    if (!memoryId || !submittedQuery) return;
    setSavingFeedback(true);
    setError(null);
    try {
      await apiRequest("/api/search/feedback", {
        method: "POST",
        ...jsonBody({ query: submittedQuery, memoryId, outcome }),
      });
      setFeedback(outcome);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "検索フィードバックを保存できませんでした。",
      );
    } finally {
      setSavingFeedback(false);
    }
  };

  const interpreted = result
    ? interpretationEntries(result.interpretation)
    : [];

  return (
    <AppShell>
      <div className="page-shell page-shell--reading">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Recall</p>
            <h1>どんな記憶を探していますか？</h1>
            <p>
              日付が曖昧でも大丈夫です。あなたの言葉を手がかりに、EvidenceのあるMemoryを探します。
            </p>
          </div>
        </header>

        <form className="recall-search" onSubmit={search} role="search">
          <label htmlFor="memory-query">思い出したいこと</label>
          <div className="search-field">
            <Search aria-hidden="true" size={21} />
            <input
              id="memory-query"
              name="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="去年の春、みんなで何か作っていた時"
              autoComplete="off"
            />
            <button
              className="button button--primary"
              type="submit"
              disabled={submitting || !online}
            >
              {submitting ? (
                <LoaderCircle className="spin" aria-hidden="true" size={18} />
              ) : null}
              検索
            </button>
          </div>
        </form>

        {mapCellId ? (
          <p className="map-search-context" role="status">
            Memory Mapで選んだ地域のMemoryを優先して探します。
          </p>
        ) : null}

        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {submitting ? (
          <StateView
            kind="loading"
            title="手がかりを整理しています"
            description="検索文を時期・場所・活動へ分け、該当するMemoryの根拠を照合しています。"
          />
        ) : null}

        {result ? (
          <div className="search-results" aria-live="polite">
            <section
              className="query-reading"
              aria-labelledby="query-reading-title"
            >
              <p className="eyebrow">Search interpretation</p>
              <h2 id="query-reading-title">
                「{submittedQuery}」をこう読み取りました
              </h2>
              {interpreted.length > 0 ? (
                <dl className="interpretation-chips">
                  {interpreted.map((entry) => (
                    <div key={`${entry.label}-${entry.value}`}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted-copy">
                  条件を細かく推定せず、入力した言葉のまま照合しました。
                </p>
              )}
            </section>

            {result.partial ? (
              <InlineNotice tone="coral">
                {result.partialMessage ||
                  "一部の検索処理が完了していません。確認できた範囲だけを表示します。"}
              </InlineNotice>
            ) : null}

            {result.answerState === "grounded" && result.answer ? (
              <section
                className="grounded-answer"
                aria-labelledby="grounded-answer-title"
              >
                <span className="truth-label truth-label--confirmed">
                  <span className="truth-label__node" aria-hidden="true" />
                  Evidenceに基づく回答
                </span>
                <h2 id="grounded-answer-title">見つかったMemory</h2>
                <p>{result.answer}</p>
                {result.sources?.length ? (
                  <details>
                    <summary>回答の根拠を表示</summary>
                    <ul>
                      {result.sources.map((source) => (
                        <li key={`${source.kind}-${source.claimId}`}>
                          {source.label} ·{" "}
                          {source.kind === "user_correction"
                            ? "あなたの確認"
                            : "Evidence"}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {result.feedbackEnabled && result.candidates[0] ? (
                  <div
                    className="search-feedback"
                    aria-label="検索結果へのフィードバック"
                  >
                    <span>
                      {feedback
                        ? "フィードバックを保存しました。"
                        : "この結果は役に立ちましたか？"}
                    </span>
                    <button
                      className={
                        feedback === "helpful"
                          ? "button button--secondary is-selected"
                          : "button button--secondary"
                      }
                      type="button"
                      disabled={savingFeedback}
                      aria-pressed={feedback === "helpful"}
                      onClick={() => void saveFeedback("helpful")}
                    >
                      <ThumbsUp aria-hidden="true" size={17} />
                      役に立った
                    </button>
                    <button
                      className={
                        feedback === "not_helpful"
                          ? "button button--secondary is-selected"
                          : "button button--secondary"
                      }
                      type="button"
                      disabled={savingFeedback}
                      aria-pressed={feedback === "not_helpful"}
                      onClick={() => void saveFeedback("not_helpful")}
                    >
                      <ThumbsDown aria-hidden="true" size={17} />
                      違った
                    </button>
                  </div>
                ) : null}
              </section>
            ) : result.answerState === "clarification" ||
              result.clarification ? (
              <StateView
                kind="partial"
                title="もう少し手がかりが必要です"
                description={
                  result.clarification ||
                  "候補をひとつに決める根拠が足りません。時期や場所を少し足してみてください。"
                }
                compact
              />
            ) : !result.partial &&
              result.answerState === "unknown" &&
              result.candidates.length === 0 ? (
              <StateView
                kind="empty"
                title="確かなMemoryを見つけられませんでした"
                description="根拠のない答えは作りません。別の時期・場所・活動の言葉を足してみてください。"
                compact
              />
            ) : null}

            {result.candidates.length > 0 ? (
              <section
                className="candidate-section"
                aria-labelledby="candidate-title"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Candidates</p>
                    <h2 id="candidate-title">近いMemory</h2>
                  </div>
                  <p>
                    {result.candidates.length > 1
                      ? "候補を決め打ちせず表示しています"
                      : "根拠が最も一致した候補です"}
                  </p>
                </div>
                <ol className="candidate-list">
                  {result.candidates.slice(0, 3).map((candidate) => (
                    <SearchCandidateRow
                      candidate={candidate}
                      key={candidate.memory.id}
                    />
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
