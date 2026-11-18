import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from '../components/AppLayout';
import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { ProfilePage } from '../pages/ProfilePage';
import { ApiClientError } from '../services/httpClient';
import { usersService } from '../services/usersService';
import type { RoleCode } from '../types/api';

function renderAppWithAuth(
  initialRoute = '/',
  roleCode: RoleCode = 'admin',
  overrides?: Partial<AuthContextValue>,
) {
  const logoutMock = vi.fn();
  const refreshProfileMock = vi.fn();

  const authValue: AuthContextValue = {
    user: {
      id: 'u-admin-1',
      full_name: 'Admin General',
      email: 'admin@restaurante.smart',
      phone: '+593991234567',
      is_active: true,
      role_code: roleCode,
      role_name: roleCode === 'admin' ? 'Administrador' : 'Cliente',
      permissions: ['users:read', 'reports:read', 'tables:read'],
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: logoutMock,
    refreshProfile: refreshProfileMock,
    hasRole: (...roles) => roles.includes(roleCode),
    hasPermission: () => true,
    ...overrides,
  };

  return {
    ...render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <AuthContext.Provider value={authValue}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<div>Dashboard Mock</div>} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/orders" element={<div>Orders Mock</div>} />
            </Route>
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    ),
    logoutMock,
    refreshProfileMock,
  };
}

describe('AppLayout y ProfilePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('AppLayout', () => {
    it('renderiza navegación con roles autorizados, información del usuario y botón de cerrar sesión', async () => {
      const user = userEvent.setup();
      const { logoutMock } = renderAppWithAuth('/', 'admin');

      expect(screen.getByText('Restaurante Smart')).toBeInTheDocument();
      expect(screen.getByText('Sesión: Administrador')).toBeInTheDocument();
      expect(screen.getByText('admin@restaurante.smart')).toBeInTheDocument();

      // Enlaces visibles para admin
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Reportes' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Usuarios y Roles' })).toBeInTheDocument();

      // Clic en Cerrar sesión
      const logoutBtn = screen.getByRole('button', { name: 'Cerrar sesión' });
      await user.click(logoutBtn);
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });

    it('oculta rutas protegidas para rol cliente', () => {
      renderAppWithAuth('/', 'customer');

      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Disponibilidad' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Reservas' })).toBeInTheDocument();

      // Rutas exclusivas de staff/admin deben estar ocultas
      expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Usuarios y Roles' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Mesas' })).not.toBeInTheDocument();
    });

    it('permite abrir y cerrar el menú móvil (botón alternar, backdrop y tecla Escape)', async () => {
      const user = userEvent.setup();
      renderAppWithAuth('/', 'admin');

      const menuToggle = screen.getByRole('button', { name: 'Abrir menú de navegación' });
      await user.click(menuToggle);

      // El sidebar debe tener la clase open
      const aside = screen.getByLabelText('Navegación principal');
      expect(aside).toHaveClass('open');

      // Cierre por Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(aside).not.toHaveClass('open');

      // Abrir de nuevo y cerrar haciendo clic en backdrop
      await user.click(menuToggle);
      expect(aside).toHaveClass('open');
      const backdrop = document.querySelector('.sidebar-backdrop')!;
      expect(backdrop).toBeInTheDocument();
      fireEvent.click(backdrop);

      expect(aside).not.toHaveClass('open');
    });
  });

  describe('ProfilePage', () => {
    it('muestra datos del perfil actual y maneja validaciones', async () => {
      const user = userEvent.setup();
      renderAppWithAuth('/profile', 'admin');

      expect(screen.getByRole('heading', { name: 'Mi Perfil y Seguridad' })).toBeInTheDocument();
      const nameInput = screen.getByLabelText('Nombre completo');
      expect(nameInput).toHaveValue('Admin General');

      // Validar nombre < 2
      await user.clear(nameInput);
      await user.type(nameInput, 'X');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      expect(
        screen.getByText('El nombre completo debe tener al menos 2 caracteres.'),
      ).toBeInTheDocument();

      // Validar contraseña opcional < 8
      await user.clear(nameInput);
      await user.type(nameInput, 'Admin General Modificado');
      const passInput = screen.getByLabelText('Nueva contraseña (opcional)');
      await user.type(passInput, 'corta');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      expect(
        screen.getByText('La nueva contraseña debe tener al menos 8 caracteres.'),
      ).toBeInTheDocument();
    });

    it('actualiza el perfil exitosamente y llama a refreshProfile', async () => {
      const user = userEvent.setup();
      const updateSpy = vi.spyOn(usersService, 'updateUser').mockResolvedValueOnce({
        id: 'u-admin-1',
        full_name: 'Admin General Actualizado',
        email: 'admin@restaurante.smart',
        phone: '+593998887766',
        is_active: true,
        role: { id: 1, code: 'admin', name: 'Administrador', description: null, permissions: [] },
        created_at: '2026-11-15T10:00:00Z',
        updated_at: '2026-11-17T15:00:00Z',
      });

      const { refreshProfileMock } = renderAppWithAuth('/profile', 'admin');

      const nameInput = screen.getByLabelText('Nombre completo');
      await user.clear(nameInput);
      await user.type(nameInput, 'Admin General Actualizado');

      const phoneInput = screen.getByLabelText('Teléfono');
      await user.clear(phoneInput);
      await user.type(phoneInput, '+593998887766');

      const passInput = screen.getByLabelText('Nueva contraseña (opcional)');
      await user.type(passInput, 'NuevaClaveValida2026!');

      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith('u-admin-1', {
          full_name: 'Admin General Actualizado',
          phone: '+593998887766',
          password: 'NuevaClaveValida2026!',
        });
      });

      expect(refreshProfileMock).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Perfil actualizado correctamente.')).toBeInTheDocument();
    });

    it('muestra error cuando la actualización de perfil falla en el servidor', async () => {
      const user = userEvent.setup();
      vi.spyOn(usersService, 'updateUser').mockRejectedValueOnce(
        new ApiClientError('Error al actualizar datos de usuario', 500),
      );

      renderAppWithAuth('/profile', 'admin');

      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      expect(
        await screen.findByText('Error al actualizar datos de usuario'),
      ).toBeInTheDocument();
    });
  });

  describe('useAsyncResource hook', () => {
    it('no ejecuta fetcher si enabled es false y maneja reload deshabilitado', async () => {
      const fetcher = vi.fn().mockResolvedValue('resultado');
      const { result } = renderHook(() => useAsyncResource(fetcher, false));

      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toBe(null);
      expect(fetcher).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.isLoading).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('maneja carga exitosa, errores y actualización manual con setData', async () => {
      const fetcher = vi.fn().mockResolvedValue('datos cargados');
      const { result } = renderHook(() => useAsyncResource(fetcher, true));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.data).toBe('datos cargados');
      expect(result.current.error).toBe(null);

      // Actualización manual con setData
      act(() => {
        result.current.setData('datos modificados');
      });
      expect(result.current.data).toBe('datos modificados');

      // Reload con fallo en fetcher
      fetcher.mockRejectedValueOnce(new ApiClientError('Fallo en fetcher', 500));
      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe('Fallo en fetcher');
    });
  });
});
