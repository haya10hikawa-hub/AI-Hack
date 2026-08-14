"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiRequest, ApiError } from "./api-client";

interface ApiResourceState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
}

export function useApiResource<T>(path: string | null): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [refreshing, setRefreshing] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const hasResolvedData = useRef(false);
  const previousPath = useRef(path);

  const reload = useCallback(() => {
    setError(null);
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let active = true;
    if (previousPath.current !== path) {
      previousPath.current = path;
      hasResolvedData.current = false;
      void Promise.resolve().then(() => {
        if (!active) return;
        setData(null);
        setError(null);
      });
    }
    if (!path) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });
      return () => {
        active = false;
      };
    }

    const controller = new AbortController();
    const isBackgroundRefresh = hasResolvedData.current;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setLoading(!isBackgroundRefresh);
        setRefreshing(isBackgroundRefresh);
        setError(null);
      }
    });

    void apiRequest<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          hasResolvedData.current = true;
          setData(value);
        }
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
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [path, requestVersion]);

  return { data, error, loading, refreshing, reload };
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
