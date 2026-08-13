import Link from "next/link";

export default function NotFound() {
  return (
    <main className="standalone-state" id="main-content">
      <span className="thread-node thread-node--open" aria-hidden="true" />
      <p className="eyebrow">Not found</p>
      <h1>このページは見つかりません</h1>
      <p>URLが変わったか、表示できないMemoryの可能性があります。</p>
      <Link className="button button--primary" href="/home">
        Memory Threadへ戻る
      </Link>
    </main>
  );
}
