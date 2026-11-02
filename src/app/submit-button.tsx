"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({
  label,
  pendingLabel,
  className,
  variant = "auth",
  style,
}: {
  label: React.ReactNode;
  pendingLabel?: React.ReactNode;
  className?: string;
  variant?: "auth" | "default" | "ghost" | "danger" | "plain";
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();

  let baseClass = "";
  if (variant === "auth") {
    baseClass = "auth-submit-btn";
  } else if (variant === "ghost") {
    baseClass = "ghost";
  } else if (variant === "danger") {
    baseClass = "ghost danger-btn";
  } else if (variant === "plain") {
    baseClass = "";
  }

  const finalClassName = [baseClass, className].filter(Boolean).join(" ");
  const displayPending = pendingLabel ?? (typeof label === "string" ? `${label}...` : "Working...");

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={finalClassName || undefined}
      style={style}
    >
      {pending ? (
        <span className="btn-spinner-wrap">
          <svg
            className="btn-spinner"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {displayPending}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

