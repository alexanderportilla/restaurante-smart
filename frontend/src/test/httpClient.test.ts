import { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authService } from '../services/authService';
import {
  ApiClientError,
  extractApiError,
  getStoredToken,
  httpClient,
  registerUnauthorizedHandler,
  setStoredToken,
} from '../services/httpClient';
import { ordersService } from '../services/ordersService';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';

describe('httpClient y servicios API tipados', () => {
  const originalAdapter = httpClient.defaults.adapter;

  beforeEach(() => {
    setStoredToken(null);
    registerUnauthorizedHandler(null);
    httpClient.defaults.adapter = originalAdapter;
  });

  it('inyecta token Bearer en las cabeceras de petición', async () => {
    setStoredToken('jwt-demo-token');
    let capturedAuth: string | undefined;

    const mockAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      capturedAuth = String(config.headers.get('Authorization') ?? '');
      return {
        data: { status: 'ok', service: 'Restaurante Smart API', database: 'connected' },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };

    httpClient.defaults.adapter = mockAdapter;
    const health = await authService.getHealth();

    expect(health.status).toBe('ok');
    expect(capturedAuth).toBe('Bearer jwt-demo-token');
  });

  it('normaliza errores de backend y limpia sesión en 401', async () => {
    setStoredToken('expired-token');
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);

    httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const error = {
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Token inválido o expirado.',
              details: null,
            },
          },
        },
        config,
      };
      return Promise.reject(error);
    };

    await expect(authService.getMe()).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Token inválido o expirado.',
    });

    expect(getStoredToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('consume endpoints exactos del contrato para disponibilidad, reservas y pedidos', async () => {
    const calls: Array<{ method?: string; url?: string }> = [];

    httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      calls.push({ method: config.method, url: config.url });
      return {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };

    await tablesService.checkAvailability('2026-11-20T19:00:00Z', '2026-11-20T21:00:00Z', 4);
    await reservationsService.createReservation({
      table_id: 1,
      customer_name: 'Carlos',
      customer_email: 'carlos@example.com',
      customer_phone: '099111222',
      party_size: 4,
      start_time: '2026-11-20T19:00:00Z',
      end_time: '2026-11-20T21:00:00Z',
    });
    await ordersService.createOrder({
      order_type: 'takeaway',
      items: [{ product_id: 10, quantity: 2 }],
    });

    expect(calls).toEqual([
      { method: 'get', url: '/availability' },
      { method: 'post', url: '/reservations' },
      { method: 'post', url: '/orders' },
    ]);
  });

  it('extractApiError maneja errores genéricos', () => {
    const err = extractApiError(new Error('Fallo local'));
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toBe('Fallo local');
  });
});
