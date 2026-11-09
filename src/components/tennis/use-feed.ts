"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedPayload } from "@/lib/tennis/types";

interface FeedState {
  data: FeedPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const POLL_MS = 90 * 1000;

export function useFeed() {
  const [state, setState] = useState<FeedState>({
    data: null,
    loading: true,
    refreshing: false,
    error: null,
    lastUpdated: null,
  });
  const firstLoad = useRef(true);

  const load = useCallback(async (force = false) => {
    setState((s) => ({
      ...s,
      loading: firstLoad.current,
      refreshing: !firstLoad.current,
      error: null,
    }));
    try {
      const res = await fetch(`/api/tennis/feed${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as FeedPayload;
      firstLoad.current = false;
      setState({
        data,
        loading: false,
        refreshing: false,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (e) {
      firstLoad.current = false;
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: e instanceof Error ? e.message : "خطای ناشناخته در دریافت فید زنده",
      }));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return { ...state, reload: load };
}
