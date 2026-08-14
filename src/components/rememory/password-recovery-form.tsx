"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";

import { apiRequest, jsonBody } from "./api-client";
import { Brand } from "./brand";
import { InlineNotice } from "./state-view";

export function PasswordRecoveryForm({ mode }: { mode: "request" | "update" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const updating = mode === "update";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (updating) {
        await apiRequest("/api/auth/update-password", {
          method: "POST",
          ...jsonBody({ password }),
        });
        setSuccess("パスワードを更新しました。Memoryへ戻ります。");
        window.setTimeout(() => {
          router.replace("/home");
          router.refresh();
        }, 700);
      } else {
        const result = await apiRequest<{ message: string }>(
          "/api/auth/password-reset",
          { method: "POST", ...jsonBody({ email }) },
        );
        setSuccess(result.message);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "パスワード再設定を完了できませんでした。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-story" aria-label="Re:Memoryについて">
        <Brand />
        <div className="auth-story__copy">
          <p className="eyebrow">Private account recovery</p>
          <h1>Memoryへの鍵を、取り戻す。</h1>
          <p>
            再設定リンクは登録メールにだけ届きます。Re:Memoryが現在のパスワードを表示することはありません。
          </p>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="recovery-title">
        <div className="auth-panel__inner">
          <p className="eyebrow">Account</p>
          <h2 id="recovery-title">
            {updating ? "新しいパスワード" : "パスワードを再設定"}
          </h2>
          <p>
            {updating
              ? "新しいパスワードを入力してください。"
              : "登録したメールアドレスへ再設定リンクを送ります。"}
          </p>
          <form className="auth-form" onSubmit={submit}>
            {updating ? (
              <>
                <label htmlFor="new-password">新しいパスワード</label>
                <div className="input-with-icon">
                  <LockKeyhole aria-hidden="true" size={19} />
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                    pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}"
                    aria-describedby="new-password-hint"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <p className="field-hint" id="new-password-hint">
                  12文字以上で、英大文字・英小文字・数字を含めてください。
                </p>
              </>
            ) : (
              <>
                <label htmlFor="recovery-email">メールアドレス</label>
                <div className="input-with-icon">
                  <Mail aria-hidden="true" size={19} />
                  <input
                    id="recovery-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </>
            )}
            {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
            {success ? (
              <InlineNotice tone="sage">{success}</InlineNotice>
            ) : null}
            <button
              className="button button--primary button--full"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <LoaderCircle className="spin" aria-hidden="true" size={19} />
              ) : null}
              {submitting
                ? "処理しています…"
                : updating
                  ? "パスワードを更新"
                  : "再設定メールを送る"}
              {!submitting ? <ArrowRight aria-hidden="true" size={19} /> : null}
            </button>
          </form>
          <p className="auth-switch">
            <Link href="/auth/login">ログインへ戻る</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
