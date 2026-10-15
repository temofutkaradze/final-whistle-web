"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While the customer has not pressed Start in their bot yet, re-read the page every few seconds,
// so it switches to "connected" by itself (no manual reload).
export default function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
