import type { Metadata } from "next";

import { MemoryMapScreen } from "@/src/components/rememory/memory-map-screen";

export const metadata: Metadata = { title: "Memory Exploration Map" };

export default function Page() {
  return <MemoryMapScreen />;
}
