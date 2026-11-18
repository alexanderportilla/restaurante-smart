import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../hooks/authContextInstance';
import { UsersPage } from '../pages/UsersPage';
import { ApiClientError } from '../services/httpClient';
import { usersService } from '../services/usersService';
import type { Role, RoleCode, UserRecord } from '../types/api';

const mockRoles: Role[] = [
  {
    id: 1,
    code: 'admin',
    name: 'Administrador',
    description: 'Control total',
    permissions: [
      { id: 1, code: 'users:write', description: null },
      { id: 2, code: 'users:read', description: null },
    ],
  },
  {
    id: 2,
    code: 'staff',
    name: 'Personal',
    description: 'Operación del salón',
    permissions: [
      { id: 3, code: 'orders:write', description: null },
    ],
  },
  {
    id: 3,
    code: 'customer',
    name: 'Cliente',
    description: 'Portal de comensales',
    permissions: [],
  },
];

const mockUsers: UserRecord[] = [
  {
    id: 'u-admin',
    full_name: 'Admin Principal',
    email: 'admin@restaurante.smart',
    phone: '+593991112233',
    is_active: true,
    role: { id: 1, code: 'admin', name: 'Administrador', description: null, permissions: [] },
    created_at: '2026-11-15T10:00:00Z',
    updated_at: '2026-11-15T12:00:00Z',
  },
  {
    id: 'u-staff',
    full_name: 'Camarero Juan',
    email: 'juan@restaurante.smart',
    phone: '+593994445566',
    is_active: true,
    role: { id: 2, code: 'staff', name: 'Personal', description: null, permissions: [] },
    created_at: '2026-11-16T08:00:00Z',
    updated_at: '2026-11-16T08:00:00Z',
  },
  {
    id: 'u-cust',
    full_name: 'Maria Cliente',
    email: 'maria@example.com',
    phone: null,
    is_active: false,
    role: { id: 3, code: 'customer', name: 'Cliente', description: null, permissions: [] },
    created_at: '2026-11-17T09:00:00Z',
    updated_at: '2026-11-17T09:00:00Z',
  },
];

function renderUsersPage(currentUserId = 'u-admin', roleCode: RoleCode = 'admin') {
  const authValue: AuthContextValue = {
    user: {
      id: currentUserId,
      full_name: currentUserId === 'u-admin' ? 'Admin Principal' : 'Camarero Juan',
      email: currentUserId === 'u-admin' ? 'admin@restaurante.smart' : 'juan@restaurante.smart',
      phone: null,
      is_active: true,
      role_code: roleCode,
      role_name: roleCode === 'admin' ? 'Administrador' : 'Personal',
      permissions: roleCode === 'admin' ? ['users:read', 'users:write'] : ['users:read'],
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
      <AuthContext.Provider value={authValue}>
        <UsersPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra estado de carga inicial y luego renderiza tabla de usuarios y roles', async () => {
    vi.spyOn(usersService, 'listUsers').mockResolvedValueOnce({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValueOnce(mockRoles);

    renderUsersPage();

    expect(screen.getByText('Cargando usuarios y roles...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Usuarios (3)')).toBeInTheDocument();
    });

    expect(screen.getByText('Admin Principal')).toBeInTheDocument();
    expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    expect(screen.getByText('Maria Cliente')).toBeInTheDocument();
    expect(screen.getByText('Tu cuenta')).toBeInTheDocument();
    expect(screen.getByText('Roles y permisos')).toBeInTheDocument();
    expect(screen.getByText('Acceso propio de cliente')).toBeInTheDocument();
  });

  it('muestra error si la carga inicial de usuarios falla', async () => {
    vi.spyOn(usersService, 'listUsers').mockRejectedValueOnce(
      new ApiClientError('Error de conexión con el servidor', 500),
    );
    vi.spyOn(usersService, 'listRoles').mockResolvedValueOnce(mockRoles);

    renderUsersPage();

    await waitFor(() => {
      expect(screen.getByText('Error de conexión con el servidor')).toBeInTheDocument();
    });
  });

  it('permite filtrar usuarios por texto y por rol', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);

    renderUsersPage();

    await waitFor(() => {
      expect(screen.getByText('Admin Principal')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Buscar en página');
    await user.type(searchInput, 'Juan');

    expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    expect(screen.queryByText('Maria Cliente')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Principal')).not.toBeInTheDocument();

    await user.clear(searchInput);
    expect(screen.getByText('Maria Cliente')).toBeInTheDocument();

    const roleSelect = screen.getByLabelText('Filtrar por rol');
    await user.selectOptions(roleSelect, 'customer');

    expect(screen.getByText('Maria Cliente')).toBeInTheDocument();
    expect(screen.queryByText('Camarero Juan')).not.toBeInTheDocument();

    // Filtro sin coincidencias
    await user.type(searchInput, 'inexistente');
    expect(screen.queryByText('Maria Cliente')).not.toBeInTheDocument();
  });

  it('valida formulario de creación de usuario en cliente y rechaza campos inválidos', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crear usuario' })).toBeInTheDocument();
    });

    // Caso: nombre muy corto (<2) o correo inválido o pass < 8
    const nameInput = screen.getByLabelText('Nombre completo');
    const emailInput = screen.getByLabelText('Correo electrónico');
    const passInput = screen.getByLabelText('Contraseña inicial');
    const submitBtn = screen.getByRole('button', { name: 'Crear usuario' });

    await user.type(nameInput, 'A');
    await user.type(emailInput, 'correo-invalido');
    await user.type(passInput, '123');
    await user.click(submitBtn);

    expect(
      screen.getByText('Verifica nombre (mín. 2), correo válido y contraseña (mín. 8 caracteres).'),
    ).toBeInTheDocument();
  });

  it('permite a un admin crear un usuario exitosamente', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);
    const createSpy = vi.spyOn(usersService, 'createUser').mockResolvedValueOnce({
      id: 'u-new',
      full_name: 'Nuevo Mesero',
      email: 'mesero@restaurante.smart',
      phone: '+593987654321',
      is_active: true,
      role: { id: 2, code: 'staff', name: 'Personal', description: null, permissions: [] },
      created_at: '2026-11-17T12:00:00Z',
      updated_at: '2026-11-17T12:00:00Z',
    });

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crear usuario' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Nombre completo'), 'Nuevo Mesero');
    await user.type(screen.getByLabelText('Correo electrónico'), 'mesero@restaurante.smart');
    await user.type(screen.getByLabelText('Teléfono'), '+593987654321');
    await user.type(screen.getByLabelText('Contraseña inicial'), 'ClaveSegura123!');
    await user.selectOptions(screen.getByLabelText('Rol'), 'staff');

    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        full_name: 'Nuevo Mesero',
        email: 'mesero@restaurante.smart',
        phone: '+593987654321',
        password: 'ClaveSegura123!',
        role_code: 'staff',
        is_active: true,
      });
    });

    expect(await screen.findByText('Usuario creado correctamente.')).toBeInTheDocument();
  });

  it('muestra mensaje de error si el servicio de creación de usuario falla', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);
    vi.spyOn(usersService, 'createUser').mockRejectedValueOnce(
      new ApiClientError('El correo ya está registrado en el sistema', 409),
    );

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crear usuario' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Nombre completo'), 'Usuario Duplicado');
    await user.type(screen.getByLabelText('Correo electrónico'), 'admin@restaurante.smart');
    await user.type(screen.getByLabelText('Contraseña inicial'), 'ClaveSegura123!');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(
      await screen.findByText('El correo ya está registrado en el sistema'),
    ).toBeInTheDocument();
  });

  it('abre modal de detalle y muestra datos formateados del usuario', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);
    vi.spyOn(usersService, 'getUser').mockResolvedValueOnce(mockUsers[1]); // Camarero Juan

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    });

    const juanRow = screen.getByText('Camarero Juan').closest('tr')!;
    const detailBtn = within(juanRow).getByRole('button', { name: 'Detalle' });
    await user.click(detailBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Usuario: Camarero Juan')).toBeInTheDocument();
    expect(within(dialog).getByText('juan@restaurante.smart')).toBeInTheDocument();
    expect(within(dialog).getByText('+593994445566')).toBeInTheDocument();
    expect(within(dialog).getByText(/Personal/)).toBeInTheDocument();

    // Cerrar modal
    const closeBtn = within(dialog).getByRole('button', { name: 'Cerrar ventana' });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('permite abrir modal de edición, validar campos y actualizar usuario', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);
    const updateSpy = vi.spyOn(usersService, 'updateUser').mockResolvedValueOnce({
      ...mockUsers[1],
      full_name: 'Juan Perez Editado',
      phone: '+593999999999',
    });

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    });

    const juanRow = screen.getByText('Camarero Juan').closest('tr')!;
    const editBtn = within(juanRow).getByRole('button', { name: 'Editar' });
    await user.click(editBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar usuario: juan@restaurante.smart')).toBeInTheDocument();

    // Validar nombre < 2 en modal de edición
    const editNameInput = within(dialog).getByLabelText('Nombre completo');
    await user.clear(editNameInput);
    await user.type(editNameInput, ' ');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    expect(
      screen.getByText('El nombre completo debe tener al menos 2 caracteres.'),
    ).toBeInTheDocument();

    // Validar contraseña opcional < 8
    await user.clear(editNameInput);
    await user.type(editNameInput, 'Juan Perez Editado');
    const editPassInput = within(dialog).getByLabelText('Nueva contraseña (opcional)');
    await user.type(editPassInput, '12345');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    expect(
      screen.getByText('La contraseña opcional debe tener al menos 8 caracteres.'),
    ).toBeInTheDocument();

    // Guardar exitosamente
    await user.clear(editPassInput);
    await user.type(editPassInput, 'NuevaClaveValida2026!');
    const editPhoneInput = within(dialog).getByLabelText('Teléfono');
    await user.clear(editPhoneInput);
    await user.type(editPhoneInput, '+593999999999');

    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('u-staff', {
        full_name: 'Juan Perez Editado',
        phone: '+593999999999',
        role_code: 'staff',
        is_active: true,
        password: 'NuevaClaveValida2026!',
      });
    });

    expect(await screen.findByText('Usuario actualizado correctamente.')).toBeInTheDocument();
  });

  it('permite cancelar el modal de edición', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    });

    const juanRow = screen.getByText('Camarero Juan').closest('tr')!;
    await user.click(within(juanRow).getByRole('button', { name: 'Editar' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Editar usuario: juan@restaurante.smart')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('permite cambiar rol directamente en la tabla y alternar estado activo/desactivar', async () => {
    const user = userEvent.setup();
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);
    const updateSpy = vi.spyOn(usersService, 'updateUser').mockResolvedValue({
      ...mockUsers[1],
      is_active: false,
    });

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    });

    // 1. Cambiar rol en la fila de Juan
    const roleSelectJuan = screen.getByLabelText('Rol de Camarero Juan');
    await user.selectOptions(roleSelectJuan, 'admin');

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('u-staff', { role_code: 'admin' });
    });
    expect(await screen.findByText('Rol actualizado correctamente.')).toBeInTheDocument();

    // 2. Alternar estado (Desactivar a Juan)
    const juanRow = screen.getByText('Camarero Juan').closest('tr')!;
    const deactivateBtn = within(juanRow).getByRole('button', { name: 'Desactivar' });
    await user.click(deactivateBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('u-staff', { is_active: false });
    });
    expect(await screen.findByText('Estado de cuenta actualizado.')).toBeInTheDocument();

    // 3. Activar a Maria Cliente
    const mariaRow = screen.getByText('Maria Cliente').closest('tr')!;
    const activateBtn = within(mariaRow).getByRole('button', { name: 'Activar' });
    await user.click(activateBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('u-cust', { is_active: true });
    });
  });

  it('respeta restricciones RBAC para usuarios no administradores', async () => {
    vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: mockUsers.length,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);

    // Renderizamos como rol staff (no admin)
    renderUsersPage('u-staff', 'staff');

    await waitFor(() => {
      expect(screen.getByText('Camarero Juan')).toBeInTheDocument();
    });

    // No debe existir el formulario de creación
    expect(screen.queryByRole('heading', { name: 'Crear usuario' })).not.toBeInTheDocument();

    // No deben existir botones de Editar ni Desactivar/Activar
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar' })).not.toBeInTheDocument();

    // Botón de detalle sí está disponible
    expect(screen.getAllByRole('button', { name: 'Detalle' }).length).toBe(3);
  });

  it('permite paginar hacia adelante y hacia atrás', async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(usersService, 'listUsers').mockResolvedValue({
      items: mockUsers,
      total: 120, // Total superior a 50 para que PaginationControls se renderice
      limit: 50,
      offset: 0,
    });
    vi.spyOn(usersService, 'listRoles').mockResolvedValue(mockRoles);

    renderUsersPage('u-admin', 'admin');

    await waitFor(() => {
      expect(screen.getByText('Página 1 de 3 (120 registros)')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: 'Siguiente' });
    expect(nextBtn).toBeEnabled();

    const prevBtn = screen.getByRole('button', { name: 'Anterior' });
    expect(prevBtn).toBeDisabled();

    // Clic en Siguiente
    await user.click(nextBtn);

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(50, 50);
    });
  });
});
