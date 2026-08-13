import type { Metadata } from "next";

import { SearchScreen } from "@/src/components/rememory/search-screen";

export const metadata: Metadata = { title: "Memoryを思い出す" };

export default function Page() {
  return <SearchScreen />;
}
