import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { AuthProvider } from '../hooks/AuthContext';
import { CatalogPage } from '../pages/CatalogPage';
import { LoginPage } from '../pages/LoginPage';
import { OrdersPage } from '../pages/OrdersPage';
import { ProfilePage } from '../pages/ProfilePage';
import { ReportsPage } from '../pages/ReportsPage';
import { ReservationsPage } from '../pages/ReservationsPage';
import { TablesPage } from '../pages/TablesPage';
import { UsersPage } from '../pages/UsersPage';
import { AppRoutes } from '../routes/AppRouter';
import { authService } from '../services/authService';
import { catalogService } from '../services/catalogService';
import {
  ApiClientError,
  getStoredToken,
  httpClient,
  setStoredToken,
} from '../services/httpClient';
import { notificationsService } from '../services/notificationsService';
import { ordersService } from '../services/ordersService';
import { reportsService } from '../services/reportsService';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';
import { usersService } from '../services/usersService';
import type { RoleCode } from '../types/api';

function makeAuthValue(roleCode: RoleCode, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: {
      id: 'u-1',
      full_name: 'Usuario Demo',
      email: 'demo@example.com',
      phone: '0991112233',
      is_active: true,
      role_code: roleCode,
      role_name: roleCode.toUpperCase(),
      permissions: roleCode === 'admin' ? ['users:read', 'users:write', 'reports:read'] : [],
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    hasRole: (...roles) => roles.includes(roleCode),
    hasPermission: () => roleCode === 'admin',
    ...overrides,
  };
}

function renderWithAuth(
  ui: React.ReactElement,
  roleCode: RoleCode = 'customer',
  overrides: Partial<AuthContextValue> = {},
) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={makeAuthValue(roleCode, overrides)}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Fase 15 — Cobertura integral de servicios, RBAC, flujos y edge cases', () => {
  const originalAdapter = httpClient.defaults.adapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    setStoredToken(null);
    httpClient.defaults.adapter = originalAdapter;
  });

  it('normaliza timeout 408, detalles 422 y consume GET /tables/{id} y PATCH /reservations/{id}', async () => {
    const calls: Array<{ method?: string; url?: string }> = [];

    httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      calls.push({ method: config.method, url: config.url });
      return {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };

    await tablesService.getTable(7);
    await reservationsService.updateReservation('res-7', { notes: 'Mesa junto a ventana' });

    expect(calls).toEqual([
      { method: 'get', url: '/tables/7' },
      { method: 'patch', url: '/reservations/res-7' },
    ]);

    httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
      Promise.reject({
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout of 15000ms exceeded',
        config,
      });

    await expect(tablesService.getTable(7)).rejects.toMatchObject({
      status: 408,
      code: 'TIMEOUT_ERROR',
    });

    httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
      Promise.reject({
        isAxiosError: true,
        message: 'Unprocessable',
        response: {
          status: 422,
          data: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Datos inválidos',
              details: [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }],
            },
          },
        },
        config,
      });

    await expect(tablesService.getTable(7)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos (email: value is not a valid email address)',
    });
  });

  it('limpia sesión inválida al iniciar y LoginPage valida formato de correo', async () => {
    const user = userEvent.setup();
    setStoredToken('stale-token');
    vi.spyOn(authService, 'getMe').mockRejectedValue(
      new ApiClientError('Token expirado.', 401, 'UNAUTHORIZED'),
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Restaurante Smart' })).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();

    renderWithAuth(<LoginPage />, 'customer', { isAuthenticated: false, user: null });
    await user.type(screen.getAllByLabelText('Correo electrónico')[0], 'correo-invalido');
    await user.type(screen.getAllByLabelText('Contraseña')[0], 'Password123!');
    await user.click(screen.getAllByRole('button', { name: 'Iniciar sesión' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ingresa un correo electrónico con formato válido.',
    );
  });

  it('RBAC para staff y cierre de sesión desde AppLayout', async () => {
    const user = userEvent.setup();
    setStoredToken('staff-token');
    vi.spyOn(authService, 'getMe').mockResolvedValue({
      id: 'u-staff',
      full_name: 'Mesero Demo',
      email: 'staff@example.com',
      phone: null,
      is_active: true,
      role_code: 'staff',
      role_name: 'Personal',
      permissions: ['reservations:manage', 'orders:manage'],
    });
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([
      {
        id: 1,
        code: 'M-01',
        name: 'Mesa 1',
        capacity: 4,
        location: 'Salón',
        is_active: true,
        created_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:00:00Z',
      },
    ]);
    vi.spyOn(tablesService, 'getTable').mockResolvedValue({
      id: 1,
      code: 'M-01',
      name: 'Mesa 1',
      capacity: 4,
      location: 'Salón',
      is_active: true,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    });

    render(
      <MemoryRouter initialEntries={['/tables']}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Gestión de Mesas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar mesa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios y Roles' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi perfil' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detalle' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Mesa M-01 — Mesa 1');

    await user.click(screen.getByRole('button', { name: 'Cerrar ventana' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Restaurante Smart' })).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();
  });

  it('TablesPage permite consultar detalle y editar mesa existente', async () => {
    const user = userEvent.setup();
    const table = {
      id: 3,
      code: 'M-03',
      name: 'Mesa VIP',
      capacity: 6,
      location: 'Privado',
      is_active: true,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([table]);
    const detailSpy = vi.spyOn(tablesService, 'getTable').mockResolvedValue(table);
    const updateSpy = vi.spyOn(tablesService, 'updateTable').mockResolvedValue({
      ...table,
      capacity: 8,
    });

    renderWithAuth(<TablesPage />, 'manager');
    expect(await screen.findByText('Mesa VIP')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detalle' }));
    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith(3));
    expect(screen.getByRole('dialog')).toHaveTextContent('6 personas');
    await user.click(screen.getByRole('button', { name: 'Cerrar ventana' }));

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const capInput = screen.getByLabelText('Capacidad', { selector: '#edit-t-cap' });
    await user.clear(capInput);
    await user.type(capInput, '8');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(3, {
        code: 'M-03',
        name: 'Mesa VIP',
        capacity: 8,
        location: 'Privado',
        is_active: true,
      }),
    );
  });

  it('ReservationsPage permite ver detalle, editar parcialmente y confirmar/cancelar', async () => {
    const user = userEvent.setup();
    const reservation = {
      id: 'res-1',
      user_id: 'u-1',
      table_id: 1,
      customer_name: 'Lucía Gómez',
      customer_email: 'lucia@example.com',
      customer_phone: '0991112233',
      party_size: 4,
      start_time: '2027-08-10T19:00:00Z',
      end_time: '2027-08-10T21:00:00Z',
      status: 'pending' as const,
      confirmation_code: 'RES-8899',
      notes: 'Aniversario',
      table: {
        id: 1,
        code: 'M-01',
        name: 'Mesa Ventana',
        capacity: 4,
        location: 'Salón',
        is_active: true,
        created_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:00:00Z',
      },
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };

    vi.spyOn(reservationsService, 'listReservations').mockResolvedValue({
      items: [reservation],
      total: 1,
      limit: 20,
      offset: 0,
    });
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([reservation.table]);
    const detailSpy = vi.spyOn(reservationsService, 'getReservation').mockResolvedValue(reservation);
    const updateSpy = vi
      .spyOn(reservationsService, 'updateReservation')
      .mockRejectedValueOnce(new ApiClientError('La mesa tiene un conflicto de horario.', 409))
      .mockResolvedValueOnce({ ...reservation, party_size: 3 });
    const statusSpy = vi
      .spyOn(reservationsService, 'updateStatus')
      .mockResolvedValue({ ...reservation, status: 'confirmed' });

    renderWithAuth(<ReservationsPage />, 'staff');
    expect(await screen.findByText('RES-8899')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detalle' }));
    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith('res-1'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Aniversario');
    await user.click(screen.getByRole('button', { name: 'Cerrar ventana' }));

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const partyInput = screen.getByLabelText('Comensales', { selector: '#edit-res-party' });
    await user.clear(partyInput);
    await user.type(partyInput, '3');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La mesa tiene un conflicto de horario.',
    );

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(statusSpy).toHaveBeenCalledWith('res-1', 'confirmed'));
  });

  it('CatalogPage permite editar categorías y productos', async () => {
    const user = userEvent.setup();
    const category = {
      id: 1,
      name: 'Entradas',
      slug: 'entradas',
      description: 'Frías',
      display_order: 1,
      is_active: true,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };
    const product = {
      id: 10,
      category_id: 1,
      name: 'Ceviche',
      sku: 'CEV-10',
      description: 'Clásico',
      price: '12.00',
      preparation_minutes: 10,
      is_available: true,
      is_active: true,
      category,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };

    vi.spyOn(catalogService, 'listCategories').mockResolvedValue([category]);
    vi.spyOn(catalogService, 'listProducts').mockResolvedValue({
      items: [product],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const updateCatSpy = vi
      .spyOn(catalogService, 'updateCategory')
      .mockResolvedValue({ ...category, name: 'Entradas Gourmet' });
    const updateProdSpy = vi
      .spyOn(catalogService, 'updateProduct')
      .mockResolvedValue({ ...product, price: '14.00' });

    renderWithAuth(<CatalogPage />, 'manager');
    expect(await screen.findByText('Ceviche')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar categoría' }));
    const catNameInput = screen.getByLabelText('Nombre', { selector: '#edit-cat-name' });
    await user.clear(catNameInput);
    await user.type(catNameInput, 'Entradas Gourmet');
    await user.click(screen.getByRole('button', { name: 'Guardar categoría' }));
    await waitFor(() =>
      expect(updateCatSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: 'Entradas Gourmet', slug: 'entradas' }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const priceInput = screen.getByLabelText('Precio ($)', { selector: '#edit-prod-price' });
    await user.clear(priceInput);
    await user.type(priceInput, '14.00');
    await user.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() =>
      expect(updateProdSpy).toHaveBeenCalledWith(10, expect.objectContaining({ price: 14 })),
    );
  });

  it('OrdersPage arma resumen interactivo, consulta detalle y avanza estado', async () => {
    const user = userEvent.setup();
    const order = {
      id: 'ord-10',
      order_number: 'ORD-20261117-0010',
      user_id: 'u-1',
      table_id: 1,
      reservation_id: null,
      order_type: 'dine_in' as const,
      subtotal: '20.00',
      tax_amount: '2.40',
      total_amount: '22.40',
      notes: 'Sin picante',
      confirmed_at: null,
      status: { id: 1, code: 'pending', name: 'Pendiente', sort_order: 1, is_terminal: false },
      items: [
        {
          id: 1,
          product_id: 5,
          quantity: 2,
          unit_price: '10.00',
          line_total: '20.00',
          special_instructions: 'Término medio',
          product_name: 'Lomo',
        },
      ],
      created_at: '2026-11-16T12:00:00Z',
      updated_at: '2026-11-16T12:00:00Z',
    };

    vi.spyOn(ordersService, 'listOrders').mockResolvedValue({
      items: [order],
      total: 1,
      limit: 20,
      offset: 0,
    });
    vi.spyOn(ordersService, 'listStatuses').mockResolvedValue([order.status]);
    vi.spyOn(tablesService, 'listTables').mockResolvedValue([
      {
        id: 1,
        code: 'M-01',
        name: 'Mesa 1',
        capacity: 4,
        location: 'Salón',
        is_active: true,
        created_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:00:00Z',
      },
    ]);
    vi.spyOn(reservationsService, 'listReservations').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(catalogService, 'listProducts').mockResolvedValue({
      items: [
        {
          id: 5,
          category_id: 1,
          name: 'Lomo',
          sku: 'LOM-01',
          description: null,
          price: '10.00',
          preparation_minutes: 15,
          is_available: true,
          is_active: true,
          category: {
            id: 1,
            name: 'Fuertes',
            slug: 'fuertes',
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
    const detailSpy = vi.spyOn(ordersService, 'getOrder').mockResolvedValue(order);
    const statusSpy = vi.spyOn(ordersService, 'updateStatus').mockResolvedValue(order);

    renderWithAuth(<OrdersPage />, 'staff');
    expect(await screen.findByText('ORD-20261117-0010')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar una unidad de Lomo' }));
    expect(screen.getByText('Resumen previo (1 productos)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Detalle' }));
    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith('ord-10'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Término medio');
    await user.click(screen.getByRole('button', { name: 'Cerrar ventana' }));

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(statusSpy).toHaveBeenCalledWith('ord-10', 'confirmed'));
  });

  it('ProfilePage, UsersPage y ReportsPage validan datos, filtros y edición', async () => {
    const user = userEvent.setup();
    const refreshMock = vi.fn().mockResolvedValue(undefined);
    const updateSpy = vi.spyOn(usersService, 'updateUser').mockResolvedValue({
      id: 'u-1',
      full_name: 'Usuario Actualizado',
      email: 'demo@example.com',
      phone: '0987654321',
      is_active: true,
      role: { id: 4, code: 'customer', name: 'Cliente', description: null, permissions: [] },
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    });

    const { unmount } = renderWithAuth(<ProfilePage />, 'customer', { refreshProfile: refreshMock });
    const nameInput = screen.getByLabelText('Nombre completo');
    await user.clear(nameInput);
    await user.type(nameInput, 'Usuario Actualizado');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('u-1', {
        full_name: 'Usuario Actualizado',
        phone: '0991112233',
        password: undefined,
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
    unmount();

    // UsersPage: auto-protección de admin en su propia cuenta + búsqueda
    const roleAdmin = { id: 1, code: 'admin', name: 'Administrador', description: null, permissions: [] };
    vi.spyOn(usersService, 'listRoles').mockResolvedValue([roleAdmin]);
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: [
        {
          id: 'u-1',
          full_name: 'Admin Principal',
          email: 'demo@example.com',
          phone: null,
          is_active: true,
          role: roleAdmin,
          created_at: '2026-11-16T10:00:00Z',
          updated_at: '2026-11-16T10:00:00Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const { unmount: unmountUsers } = renderWithAuth(<UsersPage />, 'admin');
    expect(await screen.findByText('Tu cuenta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeDisabled();
    unmountUsers();

    // ReportsPage: validación de rango invertido
    vi.spyOn(reportsService, 'getSummary').mockResolvedValue({
      from_date: null,
      to_date: null,
      total_orders: 0,
      total_revenue: '0.00',
      total_reservations: 0,
      active_tables: 0,
      orders_by_status: [],
    });
    vi.spyOn(reportsService, 'getTopProducts').mockResolvedValue({
      from_date: null,
      to_date: null,
      items: [],
    });
    vi.spyOn(notificationsService, 'listNotifications').mockResolvedValue({
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    });

    renderWithAuth(<ReportsPage />, 'admin');
    expect(await screen.findByText('Reportes Operativos')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Desde'), '2026-11-20T10:00');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-10T10:00');
    await user.click(screen.getByRole('button', { name: 'Aplicar rango' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fecha final no puede ser anterior a la fecha inicial.',
    );
  });
});
