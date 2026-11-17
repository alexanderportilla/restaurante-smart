import { useCallback, useEffect, useRef, useState } from 'react';

import { extractApiError } from '../services/httpClient';

export interface AsyncResourceState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: (next: T | null) => void;
}

export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  enabled = true,
): AsyncResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (requestId === requestIdRef.current) {
        setData(result);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(extractApiError(err).message);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetcher, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const requestId = ++requestIdRef.current;
    fetcher()
      .then((result) => {
        if (requestId === requestIdRef.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (requestId === requestIdRef.current) {
          setError(extractApiError(err).message);
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [fetcher, enabled]);

  return { data, isLoading, error, reload: load, setData };
}
