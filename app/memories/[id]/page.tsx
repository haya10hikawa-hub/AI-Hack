import type { Metadata } from "next";

import { MemoryDetailScreen } from "@/src/components/rememory/memory-detail-screen";

export const metadata: Metadata = { title: "Memoryの詳細" };

export default function Page() {
  return <MemoryDetailScreen />;
}
