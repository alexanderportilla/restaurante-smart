import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { catalogService } from '../services/catalogService';
import { extractApiError } from '../services/httpClient';
import { ordersService } from '../services/ordersService';
import { tablesService } from '../services/tablesService';
import type { OrderType } from '../types/api';
import { formatCurrency, formatDateTime } from '../utils/formatters';

const NEXT_OPERATIONAL_STATUS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
};

export function OrdersPage() {
  const { hasRole } = useAuth();
  const isStaffOrHigher = hasRole('admin', 'manager', 'staff');

  const [statusFilter, setStatusFilter] = useState('');

  const loadOrdersContext = useCallback(async () => {
    const [ordersPage, statuses, productsPage, tables] = await Promise.all([
      ordersService.listOrders({ status_code: statusFilter || undefined, limit: 50 }),
      ordersService.listStatuses(),
      catalogService.listProducts({ only_available: true, limit: 100 }),
      tablesService.listTables(true),
    ]);
    return { ordersPage, statuses, productsPage, tables };
  }, [statusFilter]);

  const { data, isLoading, error, reload } = useAsyncResource(loadOrdersContext);

  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [tableId, setTableId] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function setItemQuantity(productId: number, qty: number) {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, qty),
    }));
  }

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const selectedItems = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([pid, qty]) => ({ product_id: Number(pid), quantity: qty }));

    if (selectedItems.length === 0) {
      setFeedback({ type: 'error', text: 'Agrega al menos un producto al pedido.' });
      return;
    }

    if (orderType === 'dine_in' && !tableId) {
      setFeedback({ type: 'error', text: 'Selecciona una mesa para pedidos en el local.' });
      return;
    }

    setSubmitting(true);
    try {
      const created = await ordersService.createOrder({
        order_type: orderType,
        table_id: orderType === 'dine_in' ? Number(tableId) : null,
        notes: notes.trim() || undefined,
        items: selectedItems,
      });
      setQuantities({});
      setNotes('');
      setFeedback({
        type: 'success',
        text: `Pedido ${created.order_number} creado. Total calculado en servidor: ${formatCurrency(created.total_amount)}.`,
      });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdvanceStatus(orderId: string, statusCode: string) {
    setFeedback(null);
    try {
      await ordersService.updateStatus(orderId, statusCode);
      setFeedback({ type: 'success', text: `Estado actualizado a '${statusCode}'.` });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Gestión y Seguimiento de Pedidos</h1>
          <p className="page-subtitle">
            Pedidos en línea o en mesa con cálculo de totales y notificaciones en servidor.
          </p>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {feedback && (
        <AlertBanner
          variant={feedback.type}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <h2>Nuevo pedido</h2>
        <form onSubmit={handleCreateOrder}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="ord-type">Modalidad</label>
              <select
                id="ord-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType)}
              >
                <option value="takeaway">Para llevar</option>
                <option value="delivery">Domicilio</option>
                <option value="dine_in">En mesa</option>
              </select>
            </div>
            {orderType === 'dine_in' && (
              <div className="form-field">
                <label htmlFor="ord-table">Mesa</label>
                <select
                  id="ord-table"
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  required
                >
                  <option value="">Selecciona una mesa...</option>
                  {data?.tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field">
              <label htmlFor="ord-notes">Instrucciones</label>
              <input id="ord-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Precio unitario</th>
                  <th>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {data?.productsPage.items.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{formatCurrency(product.price)}</td>
                    <td style={{ maxWidth: '120px' }}>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        aria-label={`Cantidad de ${product.name}`}
                        value={quantities[product.id] ?? 0}
                        onChange={(e) => setItemQuantity(product.id, Number(e.target.value))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Enviando pedido...' : 'Confirmar pedido'}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="page-header" style={{ marginBottom: '0.75rem' }}>
          <h2>Seguimiento de pedidos ({data?.ordersPage.total ?? 0})</h2>
          <div className="form-field" style={{ marginBottom: 0, minWidth: '220px' }}>
            <label htmlFor="ord-status-filter">Estado</label>
            <select
              id="ord-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {data?.statuses.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <LoadingState label="Cargando pedidos..." />
        ) : !data || data.ordersPage.items.length === 0 ? (
          <p className="empty-state">No hay pedidos registrados.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Subtotal / IVA / Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.ordersPage.items.map((order) => {
                  const nextOps = NEXT_OPERATIONAL_STATUS[order.status.code] ?? [];
                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.order_number}</strong>
                        <div className="stat-label">{order.order_type}</div>
                      </td>
                      <td>{formatDateTime(order.created_at)}</td>
                      <td>
                        {order.items.map((item) => (
                          <div key={item.id}>
                            {item.quantity}× {item.product_name ?? `#${item.product_id}`} (
                            {formatCurrency(item.line_total)})
                          </div>
                        ))}
                      </td>
                      <td>
                        <div className="stat-label">Sub: {formatCurrency(order.subtotal)}</div>
                        <div className="stat-label">IVA: {formatCurrency(order.tax_amount)}</div>
                        <strong>{formatCurrency(order.total_amount)}</strong>
                      </td>
                      <td>
                        <StatusBadge status={order.status.code} />
                      </td>
                      <td>
                        <div className="actions-row">
                          {isStaffOrHigher
                            ? nextOps.map((nextCode) => (
                                <button
                                  key={nextCode}
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => void handleAdvanceStatus(order.id, nextCode)}
                                >
                                  Pasar a {nextCode}
                                </button>
                              ))
                            : order.status.code === 'pending' && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => void handleAdvanceStatus(order.id, 'cancelled')}
                                >
                                  Cancelar
                                </button>
                              )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
