import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../hooks/AuthContext';
import { AppRoutes } from '../routes/AppRouter';
import { authService } from '../services/authService';
import { setStoredToken } from '../services/httpClient';
import { notificationsService } from '../services/notificationsService';
import { ordersService } from '../services/ordersService';
import { reportsService } from '../services/reportsService';
import { reservationsService } from '../services/reservationsService';
import { usersService } from '../services/usersService';

describe('Protección de rutas y navegación RBAC', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setStoredToken(null);
  });

  it('redirige a /login cuando no hay sesión', async () => {
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Restaurante Smart' })).toBeInTheDocument();
  });

  it('bloquea /reports para rol customer y oculta enlaces administrativos', async () => {
    setStoredToken('customer-token');
    vi.spyOn(authService, 'getMe').mockResolvedValue({
      id: 'u-cust',
      full_name: 'Cliente Demo',
      email: 'cliente@example.com',
      phone: null,
      is_active: true,
      role_code: 'customer',
      role_name: 'Cliente',
      permissions: [],
    });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios y Roles' })).not.toBeInTheDocument();
  });

  it('permite a admin acceder a /users y dashboard', async () => {
    setStoredToken('admin-token');
    vi.spyOn(authService, 'getMe').mockResolvedValue({
      id: 'u-adm',
      full_name: 'Admin Demo',
      email: 'admin@example.com',
      phone: null,
      is_active: true,
      role_code: 'admin',
      role_name: 'Administrador',
      permissions: ['users:read', 'users:write', 'reports:read'],
    });
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue([
      { id: 1, code: 'admin', name: 'Administrador', description: null, permissions: [] },
    ]);
    vi.spyOn(reservationsService, 'listReservations').mockResolvedValue({
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    });
    vi.spyOn(ordersService, 'listOrders').mockResolvedValue({
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    });
    vi.spyOn(notificationsService, 'listNotifications').mockResolvedValue({
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    });
    vi.spyOn(reportsService, 'getSummary').mockResolvedValue({
      from_date: null,
      to_date: null,
      total_orders: 0,
      total_revenue: '0.00',
      total_reservations: 0,
      active_tables: 4,
      orders_by_status: [],
    });

    render(
      <MemoryRouter initialEntries={['/users']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Usuarios, Roles y Permisos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reportes' })).toBeInTheDocument();
  });
});
