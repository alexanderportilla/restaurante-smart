import { Navigate, Route, Routes } from 'react-router';

import { AppLayout } from '../components/AppLayout';
import { AvailabilityPage } from '../pages/AvailabilityPage';
import { CatalogPage } from '../pages/CatalogPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { OrdersPage } from '../pages/OrdersPage';
import { ProfilePage } from '../pages/ProfilePage';
import { ReportsPage } from '../pages/ReportsPage';
import { ReservationsPage } from '../pages/ReservationsPage';
import { TablesPage } from '../pages/TablesPage';
import { UsersPage } from '../pages/UsersPage';
import { ProtectedRoute } from './ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="availability" element={<AvailabilityPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />

          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager', 'staff']} />}>
            <Route path="tables" element={<TablesPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager']} />}>
            <Route path="reports" element={<ReportsPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
