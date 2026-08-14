import type { Metadata } from "next";

import { PasswordRecoveryForm } from "@/src/components/rememory/password-recovery-form";

export const metadata: Metadata = { title: "新しいパスワード" };

export default function Page() {
  return <PasswordRecoveryForm mode="update" />;
}
