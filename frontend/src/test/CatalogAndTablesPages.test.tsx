import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { CatalogPage } from '../pages/CatalogPage';
import { TablesPage } from '../pages/TablesPage';
import { catalogService } from '../services/catalogService';
import { ApiClientError } from '../services/httpClient';
import { tablesService } from '../services/tablesService';
import type { RoleCode } from '../types/api';

function renderWithRole(ui: React.ReactElement, roleCode: RoleCode = 'manager') {
  const authValue: AuthContextValue = {
    user: {
      id: 'u-mgr',
      full_name: 'Gerente Test',
      email: 'gerente@example.com',
      phone: null,
      is_active: true,
      role_code: roleCode,
      role_name: roleCode === 'manager' ? 'Gerente' : 'Cliente',
      permissions: ['catalog:write', 'tables:write'],
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
    hasRole: (...roles) => roles.includes(roleCode),
    hasPermission: () => true,
  };

  return render(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('CatalogPage y TablesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('CatalogPage muestra estado de carga, lista productos, permite crear categoría/producto y pausar/desactivar', async () => {
    const user = userEvent.setup();
    const category = {
      id: 1,
      name: 'Entradas',
      slug: 'entradas',
      description: null,
      display_order: 1,
      is_active: true,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };
    const product = {
      id: 10,
      category_id: 1,
      name: 'Ceviche Mixto',
      sku: 'ENT-010',
      description: 'Clásico de la casa',
      price: '16.50',
      preparation_minutes: 15,
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
      limit: 50,
      offset: 0,
    });
    const createCatSpy = vi.spyOn(catalogService, 'createCategory').mockResolvedValue({
      ...category,
      id: 2,
      name: 'Postres',
      slug: 'postres',
    });
    const createProdSpy = vi.spyOn(catalogService, 'createProduct').mockResolvedValue({
      ...product,
      id: 11,
      name: 'Tiramisú',
      sku: 'POS-001',
    });
    const updateProdSpy = vi.spyOn(catalogService, 'updateProduct').mockResolvedValue({
      ...product,
      is_available: false,
    });
    const deleteProdSpy = vi.spyOn(catalogService, 'deleteProduct').mockResolvedValue(undefined);

    renderWithRole(<CatalogPage />, 'manager');

    expect(screen.getByText('Cargando menú...')).toBeInTheDocument();
    expect(await screen.findByText('Ceviche Mixto')).toBeInTheDocument();

    // Crear categoría
    await user.type(screen.getByLabelText('Nombre', { selector: '#cat-name' }), 'Postres');
    await user.type(screen.getByLabelText('Slug'), 'postres');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));
    await waitFor(() => expect(createCatSpy).toHaveBeenCalledTimes(1));

    // Crear producto
    await user.type(screen.getByLabelText('Nombre', { selector: '#prod-name' }), 'Tiramisú');
    await user.type(screen.getByLabelText('SKU'), 'POS-001');
    await user.type(screen.getByLabelText('Precio ($)'), '7.50');
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(() => expect(createProdSpy).toHaveBeenCalledTimes(1));

    // Pausar y desactivar producto
    await user.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() =>
      expect(updateProdSpy).toHaveBeenCalledWith(10, { is_available: false }),
    );

    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(deleteProdSpy).toHaveBeenCalledWith(10));
  });

  it('CatalogPage muestra estado vacío y oculta formularios para customer', async () => {
    vi.spyOn(catalogService, 'listCategories').mockResolvedValue([]);
    vi.spyOn(catalogService, 'listProducts').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    renderWithRole(<CatalogPage />, 'customer');

    expect(
      await screen.findByText('No hay productos que coincidan con el filtro.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear categoría' })).not.toBeInTheDocument();
  });

  it('TablesPage permite crear mesas, alternar estado y muestra error HTTP', async () => {
    const user = userEvent.setup();
    const table = {
      id: 1,
      code: 'M-01',
      name: 'Mesa Central',
      capacity: 4,
      location: 'Salón principal',
      is_active: true,
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
    };

    vi.spyOn(tablesService, 'listTables').mockResolvedValue([table]);
    const createSpy = vi
      .spyOn(tablesService, 'createTable')
      .mockRejectedValueOnce(new ApiClientError('Ya existe una mesa registrada con ese código.', 409))
      .mockResolvedValueOnce({ ...table, id: 2, code: 'M-02', name: 'Mesa Terraza' });
    const updateSpy = vi
      .spyOn(tablesService, 'updateTable')
      .mockResolvedValue({ ...table, is_active: false });

    renderWithRole(<TablesPage />, 'admin');

    expect(screen.getByText('Cargando mesas...')).toBeInTheDocument();
    expect(await screen.findByText('Mesa Central')).toBeInTheDocument();

    // Error 409 de conflicto
    await user.type(screen.getByLabelText('Código'), 'M-01');
    await user.type(screen.getByLabelText('Nombre'), 'Duplicada');
    await user.click(screen.getByRole('button', { name: 'Agregar mesa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una mesa registrada con ese código.',
    );

    // Creación exitosa
    await user.clear(screen.getByLabelText('Código'));
    await user.type(screen.getByLabelText('Código'), 'M-02');
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Mesa Terraza');
    await user.click(screen.getByRole('button', { name: 'Agregar mesa' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));

    // Deshabilitar mesa
    await user.click(screen.getByRole('button', { name: 'Deshabilitar' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { is_active: false }));
  });
});
