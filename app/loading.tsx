import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <main
      className="route-loading"
      id="main-content"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle className="spin" aria-hidden="true" size={25} />
      <p>Re:Memoryを開いています…</p>
    </main>
  );
}
