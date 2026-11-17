import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { env } from '../config/env';
import type { ApiErrorPayload } from '../types/api';

const TOKEN_STORAGE_KEY = 'rs_access_token';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(message: string, status = 500, code = 'UNKNOWN_ERROR', details: unknown = null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Entornos sin almacenamiento persistente disponible
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function registerUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function extractApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorPayload>;
    const status = axiosError.response?.status ?? 0;
    const data = axiosError.response?.data;

    if (data?.error?.message) {
      let message = data.error.message;
      if (Array.isArray(data.error.details) && data.error.details.length > 0) {
        const firstDetail = data.error.details[0] as { msg?: unknown; loc?: unknown };
        if (typeof firstDetail?.msg === 'string' && firstDetail.msg.trim()) {
          const field = Array.isArray(firstDetail.loc)
            ? String(firstDetail.loc[firstDetail.loc.length - 1] ?? '')
            : '';
          message = field ? `${message} (${field}: ${firstDetail.msg})` : `${message} (${firstDetail.msg})`;
        }
      }
      return new ApiClientError(
        message,
        status,
        data.error.code ?? 'API_ERROR',
        data.error.details ?? null,
      );
    }

    if (axiosError.code === 'ECONNABORTED' || axiosError.message.toLowerCase().includes('timeout')) {
      return new ApiClientError(
        'La solicitud tardó demasiado tiempo en responder. Inténtalo de nuevo.',
        408,
        'TIMEOUT_ERROR',
      );
    }

    if (status === 0) {
      return new ApiClientError(
        'No fue posible conectar con el servidor de Restaurante Smart.',
        0,
        'NETWORK_ERROR',
      );
    }

    if (status === 429) {
      return new ApiClientError(
        'Demasiadas solicitudes. Espera un momento antes de volver a intentarlo.',
        429,
        'RATE_LIMIT_EXCEEDED',
      );
    }

    if (status >= 500) {
      return new ApiClientError(
        'Error interno del servidor. Inténtalo nuevamente más tarde.',
        status,
        'SERVER_ERROR',
      );
    }

    return new ApiClientError(
      axiosError.message || 'Ocurrió un error al procesar la solicitud.',
      status,
      'HTTP_ERROR',
      data ?? null,
    );
  }

  if (error instanceof Error) {
    return new ApiClientError(error.message, 500, 'CLIENT_ERROR');
  }

  return new ApiClientError('Error inesperado en la aplicación.', 500, 'UNKNOWN_ERROR');
}

export const httpClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const normalized = extractApiError(error);
    if (normalized.status === 401 && getStoredToken()) {
      setStoredToken(null);
      unauthorizedHandler?.();
    }
    return Promise.reject(normalized);
  },
);
