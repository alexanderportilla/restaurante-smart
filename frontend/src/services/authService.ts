import { httpClient, setStoredToken } from './httpClient';
import type {
  CurrentUser,
  HealthStatus,
  LoginPayload,
  RegisterPayload,
  TokenResponse,
} from '../types/api';

export const authService = {
  async login(payload: LoginPayload): Promise<TokenResponse> {
    const { data } = await httpClient.post<TokenResponse>('/auth/login', payload);
    setStoredToken(data.access_token);
    return data;
  },

  async register(payload: RegisterPayload): Promise<CurrentUser> {
    const { data } = await httpClient.post<CurrentUser>('/auth/register', payload);
    return data;
  },

  async getMe(): Promise<CurrentUser> {
    const { data } = await httpClient.get<CurrentUser>('/auth/me');
    return data;
  },

  async getHealth(): Promise<HealthStatus> {
    const { data } = await httpClient.get<HealthStatus>('/health');
    return data;
  },

  logout(): void {
    setStoredToken(null);
  },
};
