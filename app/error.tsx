"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="standalone-state" id="main-content">
      <AlertCircle aria-hidden="true" size={30} />
      <p className="eyebrow">Something went wrong</p>
      <h1>画面を表示できませんでした</h1>
      <p>
        保存済みのMemoryが失われたとは限りません。画面をもう一度読み込んでください。
      </p>
      <div className="button-row">
        <button
          className="button button--primary"
          type="button"
          onClick={reset}
        >
          もう一度試す
        </button>
        <Link className="button button--secondary" href="/home">
          ホームへ戻る
        </Link>
      </div>
    </main>
  );
}
