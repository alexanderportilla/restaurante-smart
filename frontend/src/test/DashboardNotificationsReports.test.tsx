import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusBadge } from '../components/StatusBadge';
import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { DashboardPage } from '../pages/DashboardPage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { UsersPage } from '../pages/UsersPage';
import { ApiClientError } from '../services/httpClient';
import { notificationsService } from '../services/notificationsService';
import { ordersService } from '../services/ordersService';
import { reportsService } from '../services/reportsService';
import { reservationsService } from '../services/reservationsService';
import { usersService } from '../services/usersService';
import type { RoleCode } from '../types/api';

function renderWithAuth(ui: React.ReactElement, roleCode: RoleCode = 'admin') {
  const authValue: AuthContextValue = {
    user: {
      id: 'u-1',
      full_name: 'Usuario Test',
      email: 'user@example.com',
      phone: null,
      is_active: true,
      role_code: roleCode,
      role_name: roleCode === 'admin' ? 'Administrador' : 'Cliente',
      permissions: roleCode === 'admin' ? ['reports:read', 'users:read', 'users:write'] : [],
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
    hasRole: (...roles) => roles.includes(roleCode),
    hasPermission: () => roleCode === 'admin',
  };

  return render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Dashboard, Notifications, Reports, Users y StatusBadge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('DashboardPage carga KPIs para admin y omite reportes para customer', async () => {
    vi.spyOn(reservationsService, 'listReservations').mockResolvedValue({
      items: [],
      total: 2,
      limit: 5,
      offset: 0,
    });
    vi.spyOn(ordersService, 'listOrders').mockResolvedValue({
      items: [],
      total: 4,
      limit: 5,
      offset: 0,
    });
    vi.spyOn(notificationsService, 'listNotifications').mockResolvedValue({
      items: [],
      total: 1,
      limit: 5,
      offset: 0,
    });
    const summarySpy = vi.spyOn(reportsService, 'getSummary').mockResolvedValue({
      from_date: null,
      to_date: null,
      total_orders: 12,
      total_revenue: '450.50',
      total_reservations: 7,
      active_tables: 8,
      orders_by_status: [],
    });

    const { unmount } = renderWithAuth(<DashboardPage />, 'admin');
    expect(screen.getByText('Cargando resumen operativo...')).toBeInTheDocument();
    expect(await screen.findByText('Mesas activas: 8')).toBeInTheDocument();
    expect(summarySpy).toHaveBeenCalledTimes(1);
    unmount();

    summarySpy.mockClear();
    renderWithAuth(<DashboardPage />, 'customer');
    expect(await screen.findByText('Panel Principal')).toBeInTheDocument();
    expect(summarySpy).not.toHaveBeenCalled();
  });

  it('NotificationsPage muestra vacío, filtra no leídas y marca como leída', async () => {
    const user = userEvent.setup();
    const listSpy = vi
      .spyOn(notificationsService, 'listNotifications')
      .mockResolvedValueOnce({
        items: [
          {
            id: 'n-1',
            user_id: 'u-1',
            channel: 'in_app',
            event_type: 'reservation_confirmed',
            title: 'Reserva confirmada (RES-1010)',
            message: 'Tu reserva fue confirmada.',
            reference_type: 'reservation',
            reference_id: 'r-1',
            status: 'sent',
            is_read: false,
            sent_at: '2026-11-16T12:00:00Z',
            created_at: '2026-11-16T12:00:00Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

    const markSpy = vi.spyOn(notificationsService, 'markAsRead').mockResolvedValue({
      id: 'n-1',
      user_id: 'u-1',
      channel: 'in_app',
      event_type: 'reservation_confirmed',
      title: 'Reserva confirmada (RES-1010)',
      message: 'Tu reserva fue confirmada.',
      reference_type: 'reservation',
      reference_id: 'r-1',
      status: 'sent',
      is_read: true,
      sent_at: '2026-11-16T12:00:00Z',
      created_at: '2026-11-16T12:00:00Z',
    });

    renderWithAuth(<NotificationsPage />, 'customer');
    expect(await screen.findByText('Reserva confirmada (RES-1010)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Marcar leída' }));
    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('n-1'));
    expect(await screen.findByText('No hay notificaciones en tu bandeja.')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Mostrar solo no leídas'));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(true, 50, 0));
  });

  it('ReportsPage muestra métricas, top productos y maneja error de API', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportsService, 'getSummary')
      .mockResolvedValueOnce({
        from_date: null,
        to_date: null,
        total_orders: 5,
        total_revenue: '120.00',
        total_reservations: 3,
        active_tables: 6,
        orders_by_status: [{ status_code: 'confirmed', status_name: 'Confirmado', count: 5 }],
      })
      .mockRejectedValueOnce(new ApiClientError('Error al calcular reportes', 500));

    vi.spyOn(reportsService, 'getTopProducts').mockResolvedValue({
      from_date: null,
      to_date: null,
      items: [
        {
          product_id: 1,
          product_name: 'Lomo Saltado',
          sku: 'PL-001',
          total_quantity: 9,
          total_revenue: '112.50',
        },
      ],
    });

    renderWithAuth(<ReportsPage />, 'admin');
    expect(await screen.findByText('Lomo Saltado')).toBeInTheDocument();
    expect(screen.getByText('Confirmado')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Desde'), '2026-11-01T08:00');
    await user.click(screen.getByRole('button', { name: 'Aplicar rango' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error al calcular reportes');
  });

  it('UsersPage permite a admin crear usuario y cambiar estado', async () => {
    const user = userEvent.setup();
    const role = { id: 3, code: 'staff', name: 'Personal', description: null, permissions: [] };
    vi.spyOn(usersService, 'listRoles').mockResolvedValue([role]);
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: [
        {
          id: 'u-staff',
          full_name: 'Mesero Uno',
          email: 'mesero@example.com',
          phone: null,
          is_active: true,
          role,
          created_at: '2026-11-16T10:00:00Z',
          updated_at: '2026-11-16T10:00:00Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const createSpy = vi.spyOn(usersService, 'createUser').mockResolvedValue({
      id: 'u-new',
      full_name: 'Nuevo Staff',
      email: 'nuevo@example.com',
      phone: null,
      is_active: true,
      role,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    });
    const updateSpy = vi.spyOn(usersService, 'updateUser').mockResolvedValue({
      id: 'u-staff',
      full_name: 'Mesero Uno',
      email: 'mesero@example.com',
      phone: null,
      is_active: false,
      role,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    });

    renderWithAuth(<UsersPage />, 'admin');
    expect(await screen.findByText('Mesero Uno')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre completo'), 'Nuevo Staff');
    await user.type(screen.getByLabelText('Correo electrónico'), 'nuevo@example.com');
    await user.type(screen.getByLabelText('Contraseña inicial'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('u-staff', { is_active: false }));
  });

  it('StatusBadge renderiza etiquetas conocidas y respaldo neutro', () => {
    const { rerender } = render(<StatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmado')).toHaveClass('badge-info');

    rerender(<StatusBadge status="custom_state" />);
    expect(screen.getByText('custom_state')).toHaveClass('badge-neutral');
  });
});
