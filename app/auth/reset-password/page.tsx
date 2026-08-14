import type { Metadata } from "next";

import { PasswordRecoveryForm } from "@/src/components/rememory/password-recovery-form";

export const metadata: Metadata = { title: "パスワードを再設定" };

export default function Page() {
  return <PasswordRecoveryForm mode="request" />;
}
