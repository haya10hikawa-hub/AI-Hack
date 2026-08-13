import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className={compact ? "brand brand--compact" : "brand"}
      href="/home"
      aria-label="Re:Memory ホーム"
    >
      <span>Re</span>
      <span className="brand__colon" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>Memory</span>
    </Link>
  );
}
