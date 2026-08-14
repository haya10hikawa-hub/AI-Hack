"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, MapPin, Search, X } from "lucide-react";

import { apiRequest } from "./api-client";
import type { PlaceCandidate, PlaceSearchPayload } from "./types";

export function PlacePicker({
  disabled = false,
  onChange,
}: {
  disabled?: boolean;
  onChange: (candidate: PlaceCandidate | null) => void;
}) {
  const listboxId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlaceCandidate | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "empty" | "error"
  >("idle");
  const requestSequence = useRef(0);
  const resultsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (selected !== null) return;
    const normalized = query.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (normalized.length < 2) return;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const payload = await apiRequest<PlaceSearchPayload>(
          `/api/places/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );
        if (sequence !== requestSequence.current) return;
        setCandidates(payload.candidates.slice(0, 8));
        setActiveIndex(payload.candidates.length > 0 ? 0 : -1);
        setStatus(payload.candidates.length > 0 ? "ready" : "empty");
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setCandidates([]);
        setActiveIndex(-1);
        setStatus("error");
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  useEffect(() => {
    if (status !== "ready" || candidates.length === 0) return;
    resultsRef.current?.scrollIntoView({ block: "nearest" });
  }, [candidates.length, status]);

  const choose = (candidate: PlaceCandidate) => {
    requestSequence.current += 1;
    setSelected(candidate);
    setQuery(candidate.name);
    setCandidates([]);
    setActiveIndex(-1);
    setStatus("idle");
    onChange(candidate);
  };

  const clear = () => {
    requestSequence.current += 1;
    setSelected(null);
    setQuery("");
    setCandidates([]);
    setActiveIndex(-1);
    setStatus("idle");
    onChange(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (selected !== null) {
      if (event.key === "Backspace" || event.key === "Delete") clear();
      return;
    }
    if (event.key === "ArrowDown" && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % candidates.length);
    } else if (event.key === "ArrowUp" && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? candidates.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const candidate = candidates[activeIndex];
      if (candidate) choose(candidate);
    } else if (event.key === "Escape") {
      setCandidates([]);
      setActiveIndex(-1);
      setStatus("idle");
    }
  };

  const expanded = selected === null && status !== "idle";
  return (
    <div className="place-picker">
      <label htmlFor={`${listboxId}-input`}>場所を追加（任意）</label>
      <div className={`place-picker-input${selected ? " is-selected" : ""}`}>
        {selected ? (
          <Check aria-hidden="true" className="place-picker-check" size={18} />
        ) : (
          <Search aria-hidden="true" size={18} />
        )}
        <input
          id={`${listboxId}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-describedby={statusId}
          autoComplete="off"
          disabled={disabled}
          enterKeyHint="search"
          inputMode="search"
          maxLength={80}
          placeholder="場所の名前を検索"
          value={query}
          readOnly={selected !== null}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setSelected(null);
            onChange(null);
            setQuery(nextQuery);
            if (nextQuery.normalize("NFKC").trim().length < 2) {
              requestSequence.current += 1;
              setCandidates([]);
              setActiveIndex(-1);
              setStatus("idle");
            }
          }}
          onKeyDown={onKeyDown}
        />
        {status === "loading" ? (
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
        ) : query.length > 0 ? (
          <button
            type="button"
            className="place-picker-clear"
            aria-label={selected ? "選択した場所を解除" : "場所検索をクリア"}
            onClick={clear}
          >
            <X aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>

      <p className="field-hint" id={statusId} aria-live="polite">
        {selected
          ? `${selected.name}を選択中。解除して再検索できます。`
          : status === "loading"
            ? "場所候補を検索しています。"
            : status === "empty"
              ? "場所候補が見つかりません。場所を設定せず続けられます。"
              : status === "error"
                ? "場所候補を取得できませんでした。写真の追加は続けられます。"
                : "2文字以上入力すると、店舗・学校・施設などの候補を表示します。"}
      </p>

      {status === "ready" && candidates.length > 0 ? (
        <ul
          ref={resultsRef}
          className="place-picker-results"
          id={listboxId}
          role="listbox"
        >
          {candidates.map((candidate, index) => (
            <li
              id={`${listboxId}-option-${index}`}
              key={candidate.id}
              role="option"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <MapPin aria-hidden="true" size={20} />
              <span>
                <strong>{candidate.name}</strong>
                <small>
                  {[candidate.area, candidate.category]
                    .filter(Boolean)
                    .join(" / ") || "地域・カテゴリ未登録"}
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div className="place-picker-selection">
          <MapPin aria-hidden="true" size={19} />
          <span>
            <strong>{selected.name}</strong>
            <small>
              {[selected.area, selected.category].filter(Boolean).join(" / ")}
            </small>
          </span>
        </div>
      ) : null}
    </div>
  );
}
