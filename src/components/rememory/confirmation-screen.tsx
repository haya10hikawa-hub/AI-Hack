"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock3, LoaderCircle, X } from "lucide-react";

import { apiRequest, jsonBody } from "./api-client";
import { AppShell } from "./app-shell";
import { InlineNotice, StateView } from "./state-view";
import type { ConfirmationPayload, MemoryGap } from "./types";
import { useApiResource } from "./use-api-resource";

type Decision = "confirm" | "correct" | "later";

export function ConfirmationScreen() {
  const resource = useApiResource<ConfirmationPayload | MemoryGap[]>(
    "/api/gaps?status=open",
  );
  const initialGaps = useMemo(() => {
    if (!resource.data) return [];
    return Array.isArray(resource.data)
      ? resource.data
      : Array.isArray(resource.data.gaps)
        ? resource.data.gaps
        : [];
  }, [resource.data]);
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<
    "confirmed" | "deferred" | null
  >(null);
  const gaps = initialGaps.filter((gap) => !resolvedIds.includes(gap.id));
  const current = gaps[0] ?? null;

  const submitDecision = async (
    decision: Decision,
    correctionText?: string,
  ) => {
    if (!current) return;
    setSubmitting(decision);
    setError(null);
    try {
      await apiRequest(`/api/gaps/${encodeURIComponent(current.id)}/confirm`, {
        method: "POST",
        ...jsonBody({
          decision,
          correctionText: correctionText?.trim() || undefined,
        }),
      });
      setSavedNotice(decision === "later" ? "deferred" : "confirmed");
      setResolvedIds((ids) => [...ids, current.id]);
      setShowCorrection(false);
      setCorrection("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "確認内容を保存できませんでした。",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const submitCorrection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!correction.trim()) {
      setError("正しい内容を短く入力してください。");
      return;
    }
    void submitDecision("correct", correction);
  };

  const partial = !Array.isArray(resource.data)
    ? resource.data?.partial
    : false;
  const partialMessage = !Array.isArray(resource.data)
    ? resource.data?.partialMessage
    : null;
  const unauthenticated = resource.error?.status === 401;

  return (
    <AppShell>
      <div className="page-shell page-shell--narrow confirmation-page">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Complete the context</p>
            <h1>ひとつだけ、教えてください</h1>
            <p>
              AIの推定を事実にはしません。あなたの確認は、新しい確かなClaimとして残ります。
            </p>
          </div>
        </header>

        {savedNotice ? (
          <div className="confirmed-transition" role="status">
            <span className="confirmed-transition__graphic" aria-hidden="true">
              <i />
              <b />
              <i />
            </span>
            <span>
              <strong>
                {savedNotice === "deferred"
                  ? "この質問は24時間後にもう一度表示します"
                  : "確認を保存しました"}
              </strong>
              <small>
                {savedNotice === "deferred"
                  ? "いま答えなくても大丈夫です。Memoryはそのまま利用できます。"
                  : "推定とは分けて、あなた由来の確認済み情報として記録しました。"}
              </small>
            </span>
            <button
              className="text-button"
              type="button"
              onClick={() => setSavedNotice(null)}
            >
              閉じる
            </button>
          </div>
        ) : null}

        {partial ? (
          <InlineNotice tone="coral">
            {partialMessage || "確認できるMemoryの一部だけを表示しています。"}
          </InlineNotice>
        ) : null}

        {resource.loading ? (
          <StateView
            kind="loading"
            title="確認できるMemoryを探しています"
            description="Evidenceと不足している文脈を照合しています。"
          />
        ) : resource.error && !unauthenticated ? (
          <StateView
            kind={resource.error.code === "NETWORK_ERROR" ? "offline" : "error"}
            title="確認事項を読み込めませんでした"
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
        ) : current ? (
          <article className="confirmation-card">
            <div className="inference-thread" aria-label="AIによる未確認の関係">
              <span className="thread-node thread-node--open" />
              <span className="thread-line thread-line--horizontal thread-line--dotted" />
              <span className="thread-node thread-node--open" />
              <small>AIによる推定・未確認</small>
            </div>
            <p className="confirmation-card__memory">
              <span>対象のMemory</span>
              <Link href={`/memories/${encodeURIComponent(current.memoryId)}`}>
                {current.memoryTitle || "タイトル未設定の記憶"}
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </p>
            <h2>{current.question}</h2>
            {current.evidenceSummary ? (
              <p className="confirmation-card__evidence">
                <strong>確認できていること</strong>
                {current.evidenceSummary}
              </p>
            ) : null}
            {current.candidateLabel ? (
              <p className="candidate-statement">
                候補: {current.candidateLabel}
              </p>
            ) : null}

            {showCorrection ? (
              <form className="correction-form" onSubmit={submitCorrection}>
                <label htmlFor="correction">正しい内容</label>
                <textarea
                  id="correction"
                  value={correction}
                  onChange={(event) => setCorrection(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="例: ○○の練習でした"
                  autoFocus
                />
                <div className="button-row">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setShowCorrection(false)}
                  >
                    戻る
                  </button>
                  <button
                    className="button button--coral"
                    type="submit"
                    disabled={submitting !== null}
                  >
                    {submitting === "correct" ? (
                      <LoaderCircle
                        className="spin"
                        aria-hidden="true"
                        size={18}
                      />
                    ) : (
                      <Check aria-hidden="true" size={18} />
                    )}
                    訂正して保存
                  </button>
                </div>
              </form>
            ) : (
              <div className="confirmation-actions">
                <button
                  className="button button--coral"
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => void submitDecision("confirm")}
                >
                  {submitting === "confirm" ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <Check aria-hidden="true" size={18} />
                  )}
                  そう
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => setShowCorrection(true)}
                >
                  <X aria-hidden="true" size={18} />
                  違う
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => void submitDecision("later")}
                >
                  {submitting === "later" ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <Clock3 aria-hidden="true" size={18} />
                  )}
                  あとで
                </button>
              </div>
            )}
            {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
            <p className="confirmation-card__progress">
              残り {gaps.length}件 · 一度に表示する質問は1つだけです
            </p>
          </article>
        ) : (
          <StateView
            kind="empty"
            title={
              unauthenticated
                ? "公開プレビューでは確認待ちはありません"
                : "いま確認が必要なMemoryはありません"
            }
            description={
              unauthenticated
                ? "公開セッションを準備しています。準備後、AIが質問すべき候補だけをここに表示します。"
                : "分からないことを無理に質問せず、役に立つ候補が十分に絞れたときだけここに表示します。"
            }
            action={
              <Link className="button button--secondary" href="/home">
                Memory Threadへ戻る
              </Link>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
