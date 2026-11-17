import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { Modal } from '../components/Modal';
import { PaginationControls } from '../components/PaginationControls';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { catalogService } from '../services/catalogService';
import { extractApiError } from '../services/httpClient';
import { ordersService } from '../services/ordersService';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';
import type { Order, OrderType } from '../types/api';
import { formatCurrency, formatDateTime, formatOrderType } from '../utils/formatters';

const NEXT_OPERATIONAL_STATUS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
};

const TRANSITION_LABELS: Record<string, string> = {
  confirmed: 'Confirmar',
  preparing: 'Preparar',
  ready: 'Marcar listo',
  delivered: 'Entregar',
  cancelled: 'Cancelar',
};

const PAGE_LIMIT = 20;

export function OrdersPage() {
  const { hasRole } = useAuth();
  const isStaffOrHigher = hasRole('admin', 'manager', 'staff');

  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const loadOrdersContext = useCallback(async () => {
    const [ordersPage, statuses, productsPage, tables, reservationsPage] = await Promise.all([
      ordersService.listOrders({
        status_code: statusFilter || undefined,
        limit: PAGE_LIMIT,
        offset,
      }),
      ordersService.listStatuses(),
      catalogService.listProducts({ only_available: true, limit: 100 }),
      tablesService.listTables(true),
      reservationsService.listReservations({ limit: 50 }).catch(() => null),
    ]);
    const activeReservations = (reservationsPage?.items ?? []).filter(
      (r) => r.status === 'pending' || r.status === 'confirmed',
    );
    return { ordersPage, statuses, productsPage, tables, activeReservations };
  }, [statusFilter, offset]);

  const { data, isLoading, error, reload } = useAsyncResource(loadOrdersContext);

  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [tableId, setTableId] = useState('');
  const [reservationId, setReservationId] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [itemInstructions, setItemInstructions] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function setItemQuantity(productId: number, qty: number) {
    const clamped = Math.min(100, Math.max(0, Number.isNaN(qty) ? 0 : Math.trunc(qty)));
    setQuantities((prev) => ({
      ...prev,
      [productId]: clamped,
    }));
  }

  function handleReservationSelect(nextReservationId: string) {
    setReservationId(nextReservationId);
    if (!nextReservationId) {
      return;
    }
    const matched = data?.activeReservations.find((r) => r.id === nextReservationId);
    if (matched) {
      setOrderType('dine_in');
      setTableId(String(matched.table_id));
    }
  }

  const availableProducts = data?.productsPage.items ?? [];
  const selectedLineItems = availableProducts
    .filter((product) => (quantities[product.id] ?? 0) > 0)
    .map((product) => ({
      product,
      quantity: quantities[product.id] ?? 0,
      specialInstructions: itemInstructions[product.id]?.trim() || undefined,
    }));

  const referenceSubtotal = selectedLineItems.reduce(
    (sum, entry) => sum + Number.parseFloat(entry.product.price) * entry.quantity,
    0,
  );

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const selectedItems = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([pid, qty]) => ({
        product_id: Number(pid),
        quantity: qty,
        special_instructions: itemInstructions[Number(pid)]?.trim() || undefined,
      }));

    if (selectedItems.length === 0) {
      setFeedback({ type: 'error', text: 'Agrega al menos un producto al pedido.' });
      return;
    }

    if (selectedItems.some((item) => item.quantity < 1 || item.quantity > 100)) {
      setFeedback({ type: 'error', text: 'Las cantidades por producto deben estar entre 1 y 100.' });
      return;
    }

    if (orderType === 'dine_in' && !tableId && !reservationId) {
      setFeedback({
        type: 'error',
        text: 'Selecciona una mesa o reserva activa para pedidos en el local.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const created = await ordersService.createOrder({
        order_type: orderType,
        table_id: orderType === 'dine_in' && tableId ? Number(tableId) : null,
        reservation_id: reservationId || null,
        notes: notes.trim() || undefined,
        items: selectedItems,
      });
      setQuantities({});
      setItemInstructions({});
      setReservationId('');
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

  async function handleViewDetail(orderId: string) {
    setFeedback(null);
    setBusyOrderId(orderId);
    try {
      const detail = await ordersService.getOrder(orderId);
      setDetailOrder(detail);
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleAdvanceStatus(orderId: string, statusCode: string) {
    setFeedback(null);
    setBusyOrderId(orderId);
    try {
      await ordersService.updateStatus(orderId, statusCode);
      setFeedback({
        type: 'success',
        text: `Pedido actualizado a '${TRANSITION_LABELS[statusCode] ?? statusCode}'.`,
      });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyOrderId(null);
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
        <form onSubmit={handleCreateOrder} noValidate>
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
                  required={!reservationId}
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
            {data && data.activeReservations.length > 0 && (
              <div className="form-field">
                <label htmlFor="ord-res">Reserva asociada (opcional)</label>
                <select
                  id="ord-res"
                  value={reservationId}
                  onChange={(e) => handleReservationSelect(e.target.value)}
                >
                  <option value="">Sin reserva vinculada</option>
                  {data.activeReservations.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.confirmation_code} — {r.table.code} ({r.customer_name})
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
                  <th>Nota del plato</th>
                </tr>
              </thead>
              <tbody>
                {availableProducts.map((product) => {
                  const qty = quantities[product.id] ?? 0;
                  return (
                    <tr key={product.id}>
                      <td>
                        <strong>{product.name}</strong>
                        <div className="stat-label">{product.category.name}</div>
                      </td>
                      <td>{formatCurrency(product.price)}</td>
                      <td>
                        <div className="qty-stepper">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-label={`Quitar una unidad de ${product.name}`}
                            disabled={qty <= 0}
                            onClick={() => setItemQuantity(product.id, qty - 1)}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            aria-label={`Cantidad de ${product.name}`}
                            value={qty}
                            onChange={(e) => setItemQuantity(product.id, Number(e.target.value))}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-label={`Agregar una unidad de ${product.name}`}
                            disabled={qty >= 100}
                            onClick={() => setItemQuantity(product.id, qty + 1)}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label={`Nota para ${product.name}`}
                          placeholder={qty > 0 ? 'Sin cebolla, término medio...' : 'Selecciona cantidad'}
                          disabled={qty === 0}
                          value={itemInstructions[product.id] ?? ''}
                          onChange={(e) =>
                            setItemInstructions((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedLineItems.length > 0 && (
            <div className="order-summary-box">
              <div className="page-header" style={{ marginBottom: '0.5rem' }}>
                <strong>Resumen previo ({selectedLineItems.length} productos)</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setQuantities({});
                    setItemInstructions({});
                  }}
                >
                  Vaciar selección
                </button>
              </div>
              <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.25rem' }}>
                {selectedLineItems.map(({ product, quantity, specialInstructions }) => (
                  <li key={product.id}>
                    {quantity}× {product.name} —{' '}
                    {formatCurrency(Number.parseFloat(product.price) * quantity)}
                    {specialInstructions ? ` (${specialInstructions})` : ''}{' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setItemQuantity(product.id, 0)}
                    >
                      Retirar
                    </button>
                  </li>
                ))}
              </ul>
              <div className="stat-label">
                Subtotal referencial: <strong>{formatCurrency(referenceSubtotal)}</strong>. El
                servidor calcula los precios, impuestos y total definitivos al confirmar.
              </div>
            </div>
          )}

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
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setOffset(0);
              }}
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
          <>
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
                    const isBusy = busyOrderId === order.id;
                    return (
                      <tr key={order.id}>
                        <td>
                          <strong>{order.order_number}</strong>
                          <div className="stat-label">{formatOrderType(order.order_type)}</div>
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
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={isBusy}
                              onClick={() => void handleViewDetail(order.id)}
                            >
                              Detalle
                            </button>
                            {isStaffOrHigher
                              ? nextOps.map((nextCode) => (
                                  <button
                                    key={nextCode}
                                    type="button"
                                    className={`btn ${
                                      nextCode === 'cancelled' ? 'btn-danger' : 'btn-secondary'
                                    } btn-sm`}
                                    disabled={isBusy}
                                    onClick={() => void handleAdvanceStatus(order.id, nextCode)}
                                  >
                                    {TRANSITION_LABELS[nextCode] ?? nextCode}
                                  </button>
                                ))
                              : order.status.code === 'pending' && (
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    disabled={isBusy}
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
            <PaginationControls
              total={data.ordersPage.total}
              limit={PAGE_LIMIT}
              offset={offset}
              onPageChange={setOffset}
            />
          </>
        )}
      </section>

      {detailOrder && (
        <Modal title={`Pedido ${detailOrder.order_number}`} onClose={() => setDetailOrder(null)}>
          <dl className="detail-list">
            <div>
              <dt>Modalidad</dt>
              <dd>{formatOrderType(detailOrder.order_type)}</dd>
            </div>
            <div>
              <dt>Estado actual</dt>
              <dd>
                <StatusBadge status={detailOrder.status.code} />
              </dd>
            </div>
            <div>
              <dt>Fecha de creación</dt>
              <dd>{formatDateTime(detailOrder.created_at)}</dd>
            </div>
            <div>
              <dt>Confirmado</dt>
              <dd>{formatDateTime(detailOrder.confirmed_at)}</dd>
            </div>
            <div>
              <dt>Mesa asignada</dt>
              <dd>{detailOrder.table_id ? `#${detailOrder.table_id}` : 'No aplica'}</dd>
            </div>
            <div>
              <dt>Notas</dt>
              <dd>{detailOrder.notes || 'Sin instrucciones'}</dd>
            </div>
          </dl>

          <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cant.</th>
                  <th>P. Unitario</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {detailOrder.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.product_name ?? `#${item.product_id}`}</div>
                      {item.special_instructions && (
                        <div className="stat-label">{item.special_instructions}</div>
                      )}
                    </td>
                    <td>{item.quantity}</td>
                    <td>{formatCurrency(item.unit_price)}</td>
                    <td>{formatCurrency(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="order-summary-box" style={{ marginBottom: 0 }}>
            <div>Subtotal: {formatCurrency(detailOrder.subtotal)}</div>
            <div>Impuestos: {formatCurrency(detailOrder.tax_amount)}</div>
            <div>
              <strong>Total: {formatCurrency(detailOrder.total_amount)}</strong>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
