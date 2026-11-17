import { useCallback } from 'react';
import { Link } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { notificationsService } from '../services/notificationsService';
import { ordersService } from '../services/ordersService';
import { reportsService } from '../services/reportsService';
import { reservationsService } from '../services/reservationsService';
import { formatCurrency, formatDateTime, formatOrderType } from '../utils/formatters';

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const canReadReports = hasRole('admin', 'manager');

  const loadDashboard = useCallback(async () => {
    const [reservations, orders, notifications, summary] = await Promise.all([
      reservationsService.listReservations({ limit: 5 }),
      ordersService.listOrders({ limit: 5 }),
      notificationsService.listNotifications(true, 5, 0),
      canReadReports ? reportsService.getSummary() : Promise.resolve(null),
    ]);
    return { reservations, orders, notifications, summary };
  }, [canReadReports]);

  const { data, isLoading, error } = useAsyncResource(loadDashboard);

  if (isLoading) {
    return <LoadingState label="Cargando resumen operativo..." />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Panel Principal</h1>
          <p className="page-subtitle">
            Rol activo: {user?.role_name} — Resumen de actividad en tiempo real.
          </p>
        </div>
        <div className="actions-row">
          <Link to="/availability" className="btn btn-secondary">
            Consultar disponibilidad
          </Link>
          <Link to="/orders" className="btn btn-primary">
            Nuevo pedido
          </Link>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data && (
        <>
          <div className="grid-cards">
            <div className="card">
              <div className="stat-label">Reservas registradas</div>
              <div className="stat-value">
                {data.summary ? data.summary.total_reservations : data.reservations.total}
              </div>
              <Link to="/reservations" className="btn btn-secondary btn-sm">
                Ver reservas
              </Link>
            </div>

            <div className="card">
              <div className="stat-label">Pedidos</div>
              <div className="stat-value">
                {data.summary ? data.summary.total_orders : data.orders.total}
              </div>
              <Link to="/orders" className="btn btn-secondary btn-sm">
                Ver pedidos
              </Link>
            </div>

            <div className="card">
              <div className="stat-label">Notificaciones sin leer</div>
              <div className="stat-value">{data.notifications.total}</div>
              <Link to="/notifications" className="btn btn-secondary btn-sm">
                Abrir bandeja
              </Link>
            </div>

            {data.summary && (
              <div className="card">
                <div className="stat-label">Ingresos acumulados</div>
                <div className="stat-value">{formatCurrency(data.summary.total_revenue)}</div>
                <div className="stat-label">Mesas activas: {data.summary.active_tables}</div>
              </div>
            )}
          </div>

          <div className="grid-two">
            <section className="card">
              <h2>Próximas reservas</h2>
              {data.reservations.items.length === 0 ? (
                <p className="empty-state">No hay reservas registradas.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Cliente</th>
                        <th>Mesa</th>
                        <th>Inicio</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reservations.items.map((res) => (
                        <tr key={res.id}>
                          <td>{res.confirmation_code}</td>
                          <td>{res.customer_name}</td>
                          <td>{res.table.code}</td>
                          <td>{formatDateTime(res.start_time)}</td>
                          <td>
                            <StatusBadge status={res.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Pedidos recientes</h2>
              {data.orders.items.length === 0 ? (
                <p className="empty-state">No hay pedidos recientes.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Número</th>
                        <th>Tipo</th>
                        <th>Total</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.items.map((order) => (
                        <tr key={order.id}>
                          <td>{order.order_number}</td>
                          <td>{formatOrderType(order.order_type)}</td>
                          <td>{formatCurrency(order.total_amount)}</td>
                          <td>
                            <StatusBadge status={order.status.code} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
