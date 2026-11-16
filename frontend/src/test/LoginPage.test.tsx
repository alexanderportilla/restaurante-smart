import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../hooks/AuthContext';
import { LoginPage } from '../pages/LoginPage';
import { authService } from '../services/authService';
import { ApiClientError } from '../services/httpClient';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('valida campos vacíos y muestra error accesible', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ingresa tu correo electrónico y contraseña.',
    );
  });

  it('permite iniciar sesión y redirige al dashboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'login').mockResolvedValue({
      access_token: 'tok-123',
      token_type: 'bearer',
      expires_in: 3600,
      user: {
        id: 'u-1',
        full_name: 'Ana Admin',
        email: 'admin@example.com',
        phone: null,
        is_active: true,
        role_code: 'admin',
        role_name: 'Administrador',
        permissions: ['reports:read'],
      },
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Dashboard Mock</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Correo electrónico'), 'admin@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => {
      expect(screen.getByText('Dashboard Mock')).toBeInTheDocument();
    });
  });

  it('permite cambiar a registro y muestra error si API falla', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'register').mockRejectedValue(
      new ApiClientError('Ya existe una cuenta registrada con ese correo electrónico.', 409, 'RESOURCE_CONFLICT'),
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '¿No tienes cuenta? Regístrate' }));
    await user.type(screen.getByLabelText('Nombre completo'), 'Carlos Pérez');
    await user.type(screen.getByLabelText('Correo electrónico'), 'carlos@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Registrar cuenta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una cuenta registrada con ese correo electrónico.',
    );
  });
});
