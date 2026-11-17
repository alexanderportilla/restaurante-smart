import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../hooks/useAuth';
import type { RoleCode } from '../types/api';

interface NavItem {
  to: string;
  label: string;
  roles?: RoleCode[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/availability', label: 'Disponibilidad' },
  { to: '/reservations', label: 'Reservas' },
  { to: '/orders', label: 'Pedidos' },
  { to: '/catalog', label: 'Menú y Categorías' },
  { to: '/tables', label: 'Mesas', roles: ['admin', 'manager', 'staff'] },
  { to: '/notifications', label: 'Notificaciones' },
  { to: '/profile', label: 'Mi perfil' },
  { to: '/reports', label: 'Reportes', roles: ['admin', 'manager'] },
  { to: '/users', label: 'Usuarios y Roles', roles: ['admin', 'manager'] },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  const visibleLinks = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role_code)),
  );

  return (
    <div className="app-shell">
      {menuOpen && (
        <div
          className="sidebar-backdrop"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Navegación principal">
        <div className="sidebar-brand">
          <strong>Restaurante Smart</strong>
          <button
            type="button"
            className="mobile-menu-btn mobile-close-btn"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleLinks.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div>Sesión: {user?.role_name}</div>
          <div>{user?.email}</div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Abrir menú de navegación"
              aria-expanded={menuOpen}
            >
              ☰ Menú
            </button>
            <span>Bienvenido, {user?.full_name}</span>
          </div>
          <div className="topbar-right">
            <span className="badge badge-info">{user?.role_code}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
