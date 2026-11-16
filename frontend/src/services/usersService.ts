import { httpClient } from './httpClient';
import type {
  PaginatedResponse,
  Role,
  UserCreatePayload,
  UserRecord,
  UserUpdatePayload,
} from '../types/api';

export const usersService = {
  async listUsers(limit = 20, offset = 0): Promise<PaginatedResponse<UserRecord>> {
    const { data } = await httpClient.get<PaginatedResponse<UserRecord>>('/users', {
      params: { limit, offset },
    });
    return data;
  },

  async getUser(userId: string): Promise<UserRecord> {
    const { data } = await httpClient.get<UserRecord>(`/users/${userId}`);
    return data;
  },

  async createUser(payload: UserCreatePayload): Promise<UserRecord> {
    const { data } = await httpClient.post<UserRecord>('/users', payload);
    return data;
  },

  async updateUser(userId: string, payload: UserUpdatePayload): Promise<UserRecord> {
    const { data } = await httpClient.patch<UserRecord>(`/users/${userId}`, payload);
    return data;
  },

  async listRoles(): Promise<Role[]> {
    const { data } = await httpClient.get<Role[]>('/roles');
    return data;
  },
};
