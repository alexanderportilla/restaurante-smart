import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { authService } from '../services/authService';
import {
  getStoredToken,
  registerUnauthorizedHandler,
  setStoredToken,
} from '../services/httpClient';
import type { CurrentUser, LoginPayload, RegisterPayload, RoleCode } from '../types/api';
import { AuthContext, type AuthContextValue } from './authContextInstance';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(getStoredToken()));

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const profile = await authService.getMe();
      setUser(profile);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(logout);
    const token = getStoredToken();
    if (!token) {
      return () => registerUnauthorizedHandler(null);
    }

    let active = true;
    authService
      .getMe()
      .then((profile) => {
        if (active) {
          setUser(profile);
        }
      })
      .catch(() => {
        if (active) {
          setStoredToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      registerUnauthorizedHandler(null);
    };
  }, [logout]);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await authService.login(payload);
    setUser(response.user);
    return response.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    return authService.register(payload);
  }, []);

  const hasRole = useCallback(
    (...roles: RoleCode[]) => Boolean(user && roles.includes(user.role_code)),
    [user],
  );

  const hasPermission = useCallback(
    (permission: string) => Boolean(user && user.permissions.includes(permission)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      register,
      logout,
      refreshProfile,
      hasRole,
      hasPermission,
    }),
    [user, isLoading, login, register, logout, refreshProfile, hasRole, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
