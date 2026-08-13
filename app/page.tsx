import type { Metadata } from "next";

import { LandingPage } from "@/src/components/rememory/landing-page";

export const metadata: Metadata = {
  title: "写真と確かな根拠から、あとで辿れる記憶へ",
};

export default function Page() {
  return <LandingPage />;
}
