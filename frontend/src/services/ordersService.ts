import { httpClient } from './httpClient';
import type {
  Order,
  OrderCreatePayload,
  OrderStatus,
  PaginatedResponse,
} from '../types/api';

export interface OrderQueryParams {
  status_code?: string;
  limit?: number;
  offset?: number;
}

export const ordersService = {
  async listStatuses(): Promise<OrderStatus[]> {
    const { data } = await httpClient.get<OrderStatus[]>('/order-statuses');
    return data;
  },

  async listOrders(params: OrderQueryParams = {}): Promise<PaginatedResponse<Order>> {
    const { data } = await httpClient.get<PaginatedResponse<Order>>('/orders', { params });
    return data;
  },

  async getOrder(orderId: string): Promise<Order> {
    const { data } = await httpClient.get<Order>(`/orders/${orderId}`);
    return data;
  },

  async createOrder(payload: OrderCreatePayload): Promise<Order> {
    const { data } = await httpClient.post<Order>('/orders', payload);
    return data;
  },

  async updateStatus(orderId: string, statusCode: string): Promise<Order> {
    const { data } = await httpClient.patch<Order>(`/orders/${orderId}/status`, {
      status_code: statusCode,
    });
    return data;
  },
};
