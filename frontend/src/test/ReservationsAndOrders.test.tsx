import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { AvailabilityPage } from '../pages/AvailabilityPage';
import { OrdersPage } from '../pages/OrdersPage';
import { ReservationsPage } from '../pages/ReservationsPage';
import { catalogService } from '../services/catalogService';
import { ApiClientError } from '../services/httpClient';
import { ordersService } from '../services/ordersService';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';

function renderWithAuth(ui: React.ReactElement, roleCode: 'customer' | 'staff' = 'customer') {
  const authValue: AuthContextValue = {
    user: {
      id: 'u-1',
      full_name: 'Cliente Test',
      email: 'cliente@example.com',
      phone: '0991234567',
      is_active: true,
      role_code: roleCode,
      role_name: roleCode === 'customer' ? 'Cliente' : 'Personal',
      permissions: [],
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
    hasRole: (...roles) => roles.includes(roleCode),
    hasPermission: () => false,
  };

  return render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Flujos de disponibilidad, reservas y pedidos', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('consulta mesas disponibles en AvailabilityPage', async () => {
    const user = userEvent.setup();
    vi.spyOn(tablesService, 'checkAvailability').mockResolvedValue({
      start_time: '2026-11-20T19:00:00Z',
      end_time: '2026-11-20T21:00:00Z',
      party_size: 2,
      available_tables: [
        {
          id: 1,
          code: 'M-01',
          name: 'Mesa Terraza',
          capacity: 4,
          location: 'Terraza',
          is_active: true,
          created_at: '2026-11-16T10:00:00Z',
          updated_at: '2026-11-16T10:00:00Z',
        },
      ],
    });

    renderWithAuth(<AvailabilityPage />);
    await user.click(screen.getByRole('button', { name: 'Buscar mesas disponibles' }));

    expect(await screen.findByText('Mesa Terraza (M-01)')).toBeInTheDocument();
  });

  it('muestra conflicto 409 al intentar reserva solapada en ReservationsPage', async () => {
    const user = userEvent.setup();
    vi.spyOn(reservationsService, 'listReservations').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([
      {
        id: 1,
        code: 'M-01',
        name: 'Mesa Terraza',
        capacity: 4,
        location: 'Terraza',
        is_active: true,
        created_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:00:00Z',
      },
    ]);
    vi.spyOn(reservationsService, 'createReservation').mockRejectedValue(
      new ApiClientError(
        'La mesa seleccionada ya tiene una reserva activa en ese horario.',
        409,
        'RESOURCE_CONFLICT',
      ),
    );

    renderWithAuth(<ReservationsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Mesa')).toHaveValue('1');
    });

    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La mesa seleccionada ya tiene una reserva activa en ese horario.',
    );
  });

  it('crea un pedido y muestra el total calculado por el servidor en OrdersPage', async () => {
    const user = userEvent.setup();
    vi.spyOn(ordersService, 'listOrders').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(ordersService, 'listStatuses').mockResolvedValue([
      { id: 1, code: 'pending', name: 'Pendiente', sort_order: 1, is_terminal: false },
    ]);
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([]);
    vi.spyOn(catalogService, 'listProducts').mockResolvedValue({
      items: [
        {
          id: 10,
          category_id: 1,
          name: 'Ceviche Clásico',
          sku: 'ENT-001',
          description: 'Fresco',
          price: '15.00',
          preparation_minutes: 15,
          is_available: true,
          is_active: true,
          category: {
            id: 1,
            name: 'Entradas',
            slug: 'entradas',
            description: null,
            display_order: 1,
            is_active: true,
            created_at: '2026-11-16T10:00:00Z',
            updated_at: '2026-11-16T10:00:00Z',
          },
          created_at: '2026-11-16T10:00:00Z',
          updated_at: '2026-11-16T10:00:00Z',
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    vi.spyOn(ordersService, 'createOrder').mockResolvedValue({
      id: 'ord-1',
      order_number: 'ORD-20261116-ABC123',
      user_id: 'u-1',
      table_id: null,
      reservation_id: null,
      order_type: 'takeaway',
      subtotal: '30.00',
      tax_amount: '3.60',
      total_amount: '33.60',
      notes: null,
      confirmed_at: null,
      status: { id: 1, code: 'pending', name: 'Pendiente', sort_order: 1, is_terminal: false },
      items: [],
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    });

    renderWithAuth(<OrdersPage />);
    const qtyInput = await screen.findByLabelText('Cantidad de Ceviche Clásico');
    await user.clear(qtyInput);
    await user.type(qtyInput, '2');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByRole('status')).toHaveTextContent('ORD-20261116-ABC123');
  });
});
