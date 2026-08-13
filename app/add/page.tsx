import type { Metadata } from "next";

import { UploadScreen } from "@/src/components/rememory/upload-screen";

export const metadata: Metadata = { title: "写真を追加" };

export default function Page() {
  return <UploadScreen />;
}
