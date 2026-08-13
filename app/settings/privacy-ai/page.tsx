import type { Metadata } from "next";

import { PrivacyAiScreen } from "@/src/components/rememory/privacy-ai-screen";

export const metadata: Metadata = { title: "Privacy & AI" };

export default function Page() {
  return <PrivacyAiScreen />;
}
