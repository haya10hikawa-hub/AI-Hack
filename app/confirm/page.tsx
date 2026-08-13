import type { Metadata } from "next";

import { ConfirmationScreen } from "@/src/components/rememory/confirmation-screen";

export const metadata: Metadata = { title: "Memoryを確認" };

export default function Page() {
  return <ConfirmationScreen />;
}
