import type { ReactNode } from "react";
import {
  AlertCircle,
  CloudOff,
  Inbox,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

type StateKind = "loading" | "empty" | "error" | "offline" | "partial";

interface StateViewProps {
  kind: StateKind;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

const icons = {
  loading: LoaderCircle,
  empty: Inbox,
  error: AlertCircle,
  offline: CloudOff,
  partial: RotateCcw,
};

export function StateView({
  kind,
  title,
  description,
  action,
  compact = false,
}: StateViewProps) {
  const Icon = icons[kind];
  return (
    <section
      className={`state-view state-view--${kind}${compact ? " state-view--compact" : ""}`}
      aria-live={kind === "loading" ? "polite" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
    >
      <Icon
        aria-hidden="true"
        className={kind === "loading" ? "spin" : undefined}
        size={24}
      />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="state-view__action">{action}</div> : null}
    </section>
  );
}

export function InlineNotice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "sage" | "coral" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`inline-notice inline-notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
