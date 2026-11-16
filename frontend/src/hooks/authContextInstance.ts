import { createContext } from 'react';

import type { CurrentUser, LoginPayload, RegisterPayload, RoleCode } from '../types/api';

export interface AuthContextValue {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<CurrentUser>;
  register: (payload: RegisterPayload) => Promise<CurrentUser>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  hasRole: (...roles: RoleCode[]) => boolean;
  hasPermission: (permission: string) => boolean;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
