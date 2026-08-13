"use client";

import { useCallback, useEffect, useState } from "react";

import { apiRequest, ApiError } from "./api-client";

interface ApiResourceState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useApiResource<T>(path: string | null): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [requestVersion, setRequestVersion] = useState(0);

  const reload = useCallback(() => {
    setLoading(Boolean(path));
    setError(null);
    setRequestVersion((version) => version + 1);
  }, [path]);

  useEffect(() => {
    if (!path) {
      return;
    }

    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError(null);
      }
    });

    void apiRequest<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError("データを読み込めませんでした。", 0),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path, requestVersion]);

  return { data, error, loading, reload };
}

export function useConnectivity(): boolean {
  const [online, setOnline] = useState(() =>
    typeof window === "undefined" ? true : window.navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
