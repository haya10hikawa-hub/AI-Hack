import type { Metadata } from "next";

import { HomeScreen } from "@/src/components/rememory/home-screen";

export const metadata: Metadata = { title: "Memory Thread" };

export default function Page() {
  return <HomeScreen />;
}
