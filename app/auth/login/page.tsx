import type { Metadata } from "next";

import { AuthForm } from "@/src/components/rememory/auth-form";

export const metadata: Metadata = { title: "ログイン" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ confirmation?: string }>;
}) {
  const confirmationFailed =
    (await searchParams).confirmation === "failed"
      ? "メール確認を完了できませんでした。リンクの有効期限を確認して、もう一度お試しください。"
      : null;
  return <AuthForm mode="login" initialNotice={confirmationFailed} />;
}
