import { Navigate, Outlet, useLocation } from 'react-router';

import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import type { RoleCode } from '../types/api';

interface ProtectedRouteProps {
  allowedRoles?: RoleCode[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState label="Verificando sesión..." />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role_code)) {
    return (
      <section className="card" role="alert">
        <h2>Acceso restringido</h2>
        <p>Tu rol actual ({user.role_name}) no tiene permisos para acceder a este módulo.</p>
      </section>
    );
  }

  return <Outlet />;
}
