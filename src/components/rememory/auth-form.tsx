"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";

import { apiRequest, jsonBody } from "./api-client";
import { Brand } from "./brand";
import { InlineNotice } from "./state-view";

interface AuthResponse {
  redirectTo?: string;
  authenticated?: boolean;
  emailConfirmationRequired?: boolean;
  message?: string;
}

export function AuthForm({
  mode,
  initialNotice = null,
}: {
  mode: "login" | "sign-up";
  initialNotice?: string | null;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialNotice);
  const [success, setSuccess] = useState<string | null>(null);
  const signUp = mode === "sign-up";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiRequest<AuthResponse>(
        signUp ? "/api/auth/sign-up" : "/api/auth/sign-in",
        {
          method: "POST",
          ...jsonBody(
            signUp ? { displayName, email, password } : { email, password },
          ),
        },
      );
      if (result.emailConfirmationRequired) {
        setSuccess(
          result.message ||
            "確認メールを送りました。メール内のリンクから登録を完了してください。",
        );
      } else {
        router.replace(result.redirectTo || "/home");
        router.refresh();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "認証を完了できませんでした。",
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
          <p className="eyebrow">Evidence-backed memory</p>
          <h1>記憶を、確かな手がかりから。</h1>
          <p>
            写真に残るEvidenceと、あなた自身の確認を分けて保存します。AIが分からないことを、勝手に事実にはしません。
          </p>
        </div>
        <div
          className="auth-thread"
          aria-label="Evidence、AI推定、確認済みMemoryの関係"
        >
          <span>
            <i className="thread-node thread-node--filled" />
            Evidence
          </span>
          <b className="thread-line thread-line--dotted" />
          <span>
            <i className="thread-node thread-node--open" />
            AIによる推定
          </span>
          <b className="thread-line" />
          <span>
            <i className="thread-node thread-node--filled" />
            あなたの確認
          </span>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel__inner">
          <p className="eyebrow">
            {signUp ? "Create your archive" : "Welcome back"}
          </p>
          <h2 id="auth-title">
            {signUp ? "Re:Memoryをはじめる" : "おかえりなさい"}
          </h2>
          <p>
            {signUp
              ? "あなた専用の非公開Memory空間をつくります。"
              : "非公開のMemory空間へログインします。"}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {signUp ? (
              <>
                <label htmlFor="display-name">表示名</label>
                <input
                  className="text-input"
                  id="display-name"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={80}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </>
            ) : null}
            <label htmlFor="email">メールアドレス</label>
            <div className="input-with-icon">
              <Mail aria-hidden="true" size={19} />
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <label htmlFor="password">パスワード</label>
            <div className="input-with-icon">
              <LockKeyhole aria-hidden="true" size={19} />
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={signUp ? "new-password" : "current-password"}
                required
                minLength={signUp ? 12 : 8}
                maxLength={200}
                pattern={
                  signUp ? "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}" : undefined
                }
                aria-describedby={signUp ? "password-hint" : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {signUp ? (
              <p className="field-hint" id="password-hint">
                12文字以上で、英大文字・英小文字・数字を含めてください。
              </p>
            ) : null}
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
                ? "確認しています…"
                : signUp
                  ? "アカウントを作成"
                  : "ログイン"}
              {!submitting ? <ArrowRight aria-hidden="true" size={19} /> : null}
            </button>
          </form>
          <p className="auth-switch">
            {signUp
              ? "すでにアカウントをお持ちですか？"
              : "はじめて使いますか？"}
            <Link href={signUp ? "/auth/login" : "/auth/sign-up"}>
              {signUp ? "ログイン" : "アカウントを作成"}
            </Link>
          </p>
          <Link className="back-link auth-back" href="/">
            Re:Memoryについて見る
          </Link>
        </div>
      </section>
    </main>
  );
}
