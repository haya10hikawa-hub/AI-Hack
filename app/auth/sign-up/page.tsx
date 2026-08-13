import type { Metadata } from "next";

import { AuthForm } from "@/src/components/rememory/auth-form";

export const metadata: Metadata = { title: "アカウントを作成" };

export default function Page() {
  return <AuthForm mode="sign-up" />;
}
