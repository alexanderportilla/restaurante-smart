import { httpClient } from './httpClient';
import type {
  PaginatedResponse,
  Reservation,
  ReservationCreatePayload,
  ReservationStatus,
  ReservationUpdatePayload,
} from '../types/api';

export interface ReservationQueryParams {
  status?: ReservationStatus;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export const reservationsService = {
  async listReservations(
    params: ReservationQueryParams = {},
  ): Promise<PaginatedResponse<Reservation>> {
    const { data } = await httpClient.get<PaginatedResponse<Reservation>>('/reservations', {
      params,
    });
    return data;
  },

  async getReservation(reservationId: string): Promise<Reservation> {
    const { data } = await httpClient.get<Reservation>(`/reservations/${reservationId}`);
    return data;
  },

  async createReservation(payload: ReservationCreatePayload): Promise<Reservation> {
    const { data } = await httpClient.post<Reservation>('/reservations', payload);
    return data;
  },

  async updateReservation(
    reservationId: string,
    payload: ReservationUpdatePayload,
  ): Promise<Reservation> {
    const { data } = await httpClient.patch<Reservation>(`/reservations/${reservationId}`, payload);
    return data;
  },

  async updateStatus(reservationId: string, status: ReservationStatus): Promise<Reservation> {
    const { data } = await httpClient.patch<Reservation>(
      `/reservations/${reservationId}/status`,
      { status },
    );
    return data;
  },
};
