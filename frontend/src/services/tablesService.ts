import { httpClient } from './httpClient';
import type { AvailabilityResponse, RestaurantTable, TablePayload } from '../types/api';

export const tablesService = {
  async listTables(onlyActive = false): Promise<RestaurantTable[]> {
    const { data } = await httpClient.get<RestaurantTable[]>('/tables', {
      params: { only_active: onlyActive },
    });
    return data;
  },

  async createTable(payload: TablePayload): Promise<RestaurantTable> {
    const { data } = await httpClient.post<RestaurantTable>('/tables', payload);
    return data;
  },

  async updateTable(tableId: number, payload: Partial<TablePayload>): Promise<RestaurantTable> {
    const { data } = await httpClient.patch<RestaurantTable>(`/tables/${tableId}`, payload);
    return data;
  },

  async checkAvailability(
    startTime: string,
    endTime: string,
    partySize: number,
  ): Promise<AvailabilityResponse> {
    const { data } = await httpClient.get<AvailabilityResponse>('/availability', {
      params: {
        start_time: startTime,
        end_time: endTime,
        party_size: partySize,
      },
    });
    return data;
  },
};
