import { useCallback, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { Modal } from '../components/Modal';
import { PaginationControls } from '../components/PaginationControls';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';
import type { Reservation, ReservationStatus } from '../types/api';
import {
  defaultDateTimeRange,
  formatDateTime,
  formatStatusLabel,
  isValidEmail,
  toLocalDateTimeInput,
  toUtcIsoString,
} from '../utils/formatters';

interface PreselectState {
  tableId?: number;
  startLocal?: string;
  endLocal?: string;
  partySize?: number;
}

const PAGE_LIMIT = 20;

export function ReservationsPage() {
  const { user, hasRole } = useAuth();
  const isStaffOrHigher = hasRole('admin', 'manager', 'staff');
  const location = useLocation();
  const preselect = (location.state as PreselectState | null) ?? {};
  const defaults = defaultDateTimeRange();

  const [statusFilter, setStatusFilter] = useState<ReservationStatus | ''>('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const loadData = useCallback(async () => {
    const [reservations, tables] = await Promise.all([
      reservationsService.listReservations({
        status: statusFilter || undefined,
        from_date: fromFilter ? toUtcIsoString(fromFilter) : undefined,
        to_date: toFilter ? toUtcIsoString(toFilter) : undefined,
        limit: PAGE_LIMIT,
        offset,
      }),
      tablesService.listTables(true),
    ]);
    return { reservations, tables };
  }, [statusFilter, fromFilter, toFilter, offset]);

  const { data, isLoading, error, reload } = useAsyncResource(loadData);

  const [tableId, setTableId] = useState<string>(
    preselect.tableId ? String(preselect.tableId) : '',
  );
  const [customerName, setCustomerName] = useState(user?.full_name ?? '');
  const [customerEmail, setCustomerEmail] = useState(user?.email ?? '');
  const [customerPhone, setCustomerPhone] = useState(user?.phone ?? '');
  const [partySize, setPartySize] = useState(
    preselect.partySize ? String(preselect.partySize) : '2',
  );
  const [startLocal, setStartLocal] = useState(preselect.startLocal ?? defaults.startLocal);
  const [endLocal, setEndLocal] = useState(preselect.endLocal ?? defaults.endLocal);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyReservationId, setBusyReservationId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [editTableId, setEditTableId] = useState('');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerEmail, setEditCustomerEmail] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editPartySize, setEditPartySize] = useState('2');
  const [editStartLocal, setEditStartLocal] = useState('');
  const [editEndLocal, setEditEndLocal] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  async function handleCreateReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const selectedTableId = Number(tableId || data?.tables[0]?.id);
    const partyCount = Number(partySize);
    if (
      !selectedTableId ||
      customerName.trim().length < 2 ||
      !isValidEmail(customerEmail) ||
      customerPhone.trim().length < 5
    ) {
      setFeedback({
        type: 'error',
        text: 'Completa mesa, nombre (mín. 2), correo válido y teléfono (mín. 5 dígitos).',
      });
      return;
    }

    if (!Number.isInteger(partyCount) || partyCount < 1 || partyCount > 50) {
      setFeedback({ type: 'error', text: 'Los comensales deben estar entre 1 y 50.' });
      return;
    }

    const startIso = toUtcIsoString(startLocal);
    const endIso = toUtcIsoString(endLocal);
    if (new Date(endIso) <= new Date(startIso)) {
      setFeedback({ type: 'error', text: 'La hora de fin debe ser posterior a la hora de inicio.' });
      return;
    }

    setSubmitting(true);
    try {
      const created = await reservationsService.createReservation({
        table_id: selectedTableId,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim(),
        customer_phone: customerPhone.trim(),
        party_size: partyCount,
        start_time: startIso,
        end_time: endIso,
        notes: notes.trim() || undefined,
      });
      setNotes('');
      setFeedback({
        type: 'success',
        text: `Reserva confirmada (${created.confirmation_code}). Se generó tu notificación automática.`,
      });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewDetail(reservationId: string) {
    setFeedback(null);
    setBusyReservationId(reservationId);
    try {
      const detail = await reservationsService.getReservation(reservationId);
      setDetailReservation(detail);
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyReservationId(null);
    }
  }

  function openEditModal(res: Reservation) {
    setEditingReservation(res);
    setEditTableId(String(res.table_id));
    setEditCustomerName(res.customer_name);
    setEditCustomerEmail(res.customer_email);
    setEditCustomerPhone(res.customer_phone);
    setEditPartySize(String(res.party_size));
    setEditStartLocal(toLocalDateTimeInput(res.start_time));
    setEditEndLocal(toLocalDateTimeInput(res.end_time));
    setEditNotes(res.notes ?? '');
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingReservation) {
      return;
    }
    setFeedback(null);

    const targetTableId = Number(editTableId);
    const partyCount = Number(editPartySize);
    if (
      !targetTableId ||
      editCustomerName.trim().length < 2 ||
      !isValidEmail(editCustomerEmail) ||
      editCustomerPhone.trim().length < 5
    ) {
      setFeedback({
        type: 'error',
        text: 'Verifica mesa, nombre, correo válido y teléfono para actualizar la reserva.',
      });
      return;
    }

    if (!Number.isInteger(partyCount) || partyCount < 1 || partyCount > 50) {
      setFeedback({ type: 'error', text: 'El número de comensales debe estar entre 1 y 50.' });
      return;
    }

    const startIso = toUtcIsoString(editStartLocal);
    const endIso = toUtcIsoString(editEndLocal);
    if (new Date(endIso) <= new Date(startIso)) {
      setFeedback({ type: 'error', text: 'La hora de fin debe ser posterior a la hora de inicio.' });
      return;
    }

    setEditSubmitting(true);
    try {
      const updated = await reservationsService.updateReservation(editingReservation.id, {
        table_id: targetTableId,
        customer_name: editCustomerName.trim(),
        customer_email: editCustomerEmail.trim(),
        customer_phone: editCustomerPhone.trim(),
        party_size: partyCount,
        start_time: startIso,
        end_time: endIso,
        notes: editNotes.trim() || null,
      });
      setEditingReservation(null);
      setFeedback({
        type: 'success',
        text: `Reserva ${updated.confirmation_code} actualizada correctamente.`,
      });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleStatusChange(reservationId: string, nextStatus: ReservationStatus) {
    setFeedback(null);
    setBusyReservationId(reservationId);
    try {
      await reservationsService.updateStatus(reservationId, nextStatus);
      setFeedback({
        type: 'success',
        text: `Reserva actualizada a ${formatStatusLabel(nextStatus).toLowerCase()}.`,
      });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyReservationId(null);
    }
  }

  // Agrupación visual por fecha para vista tipo calendario diario
  const groupedByDate = (data?.reservations.items ?? []).reduce<Record<string, Reservation[]>>(
    (acc, item) => {
      const day = item.start_time.slice(0, 10);
      acc[day] = acc[day] ?? [];
      acc[day].push(item);
      return acc;
    },
    {},
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Calendario y Gestión de Reservas</h1>
          <p className="page-subtitle">
            Reservas con confirmación automática y bloqueo de horarios solapados.
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
        <h2>Nueva reserva</h2>
        <form onSubmit={handleCreateReservation} noValidate>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="res-table">Mesa</label>
              <select
                id="res-table"
                value={tableId || data?.tables[0]?.id || ''}
                onChange={(e) => setTableId(e.target.value)}
              >
                {data?.tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name} ({t.capacity} pers.)
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="res-name">Cliente</label>
              <input
                id="res-name"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="res-email">Correo</label>
              <input
                id="res-email"
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="res-phone">Teléfono</label>
              <input
                id="res-phone"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="res-party">Comensales</label>
              <input
                id="res-party"
                type="number"
                min="1"
                max="50"
                required
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="res-start">Inicio</label>
              <input
                id="res-start"
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="res-end">Fin</label>
              <input
                id="res-end"
                type="datetime-local"
                required
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="res-notes">Notas adicionales</label>
            <input id="res-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Reservando...' : 'Confirmar reserva'}
          </button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="form-grid">
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="res-filter">Filtrar por estado</label>
            <select
              id="res-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as ReservationStatus | '');
                setOffset(0);
              }}
            >
              <option value="">Todos los estados</option>
              <option value="confirmed">Confirmada</option>
              <option value="pending">Pendiente</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
              <option value="no_show">No asistió</option>
            </select>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="res-from">Desde</label>
            <input
              id="res-from"
              type="datetime-local"
              value={fromFilter}
              onChange={(e) => {
                setFromFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="res-to">Hasta</label>
            <input
              id="res-to"
              type="datetime-local"
              value={toFilter}
              onChange={(e) => {
                setToFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>
        </div>
      </section>

      {isLoading ? (
        <LoadingState label="Cargando agenda de reservas..." />
      ) : Object.keys(groupedByDate).length === 0 ? (
        <div className="card empty-state">No hay reservas registradas para el filtro actual.</div>
      ) : (
        <>
          {Object.entries(groupedByDate).map(([day, items]) => (
            <section key={day} className="card" style={{ marginBottom: '1rem' }}>
              <h2>Agenda {day}</h2>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Cliente</th>
                      <th>Mesa</th>
                      <th>Horario</th>
                      <th>Comensales</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((res) => {
                      const canEditOrCancel = res.status === 'pending' || res.status === 'confirmed';
                      const isBusy = busyReservationId === res.id;
                      return (
                        <tr key={res.id}>
                          <td>{res.confirmation_code}</td>
                          <td>
                            <div>{res.customer_name}</div>
                            <div className="stat-label">{res.customer_phone}</div>
                          </td>
                          <td>
                            {res.table.code} ({res.table.name})
                          </td>
                          <td>
                            {formatDateTime(res.start_time)} — {formatDateTime(res.end_time)}
                          </td>
                          <td>{res.party_size}</td>
                          <td>
                            <StatusBadge status={res.status} />
                          </td>
                          <td>
                            <div className="actions-row">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={isBusy}
                                onClick={() => void handleViewDetail(res.id)}
                              >
                                Detalle
                              </button>
                              {canEditOrCancel && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={isBusy}
                                    onClick={() => openEditModal(res)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    disabled={isBusy}
                                    onClick={() => void handleStatusChange(res.id, 'cancelled')}
                                  >
                                    Cancelar
                                  </button>
                                </>
                              )}
                              {isStaffOrHigher && res.status === 'pending' && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={isBusy}
                                  onClick={() => void handleStatusChange(res.id, 'confirmed')}
                                >
                                  Confirmar
                                </button>
                              )}
                              {isStaffOrHigher && res.status === 'confirmed' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={isBusy}
                                    onClick={() => void handleStatusChange(res.id, 'completed')}
                                  >
                                    Completar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={isBusy}
                                    onClick={() => void handleStatusChange(res.id, 'no_show')}
                                  >
                                    No asistió
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {data && (
            <div className="card">
              <PaginationControls
                total={data.reservations.total}
                limit={PAGE_LIMIT}
                offset={offset}
                onPageChange={setOffset}
              />
            </div>
          )}
        </>
      )}

      {detailReservation && (
        <Modal
          title={`Reserva ${detailReservation.confirmation_code}`}
          onClose={() => setDetailReservation(null)}
        >
          <dl className="detail-list">
            <div>
              <dt>Cliente</dt>
              <dd>{detailReservation.customer_name}</dd>
            </div>
            <div>
              <dt>Correo</dt>
              <dd>{detailReservation.customer_email}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{detailReservation.customer_phone}</dd>
            </div>
            <div>
              <dt>Mesa</dt>
              <dd>
                {detailReservation.table.code} — {detailReservation.table.name}
              </dd>
            </div>
            <div>
              <dt>Comensales</dt>
              <dd>{detailReservation.party_size}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <StatusBadge status={detailReservation.status} />
              </dd>
            </div>
            <div>
              <dt>Inicio</dt>
              <dd>{formatDateTime(detailReservation.start_time)}</dd>
            </div>
            <div>
              <dt>Fin</dt>
              <dd>{formatDateTime(detailReservation.end_time)}</dd>
            </div>
          </dl>
          <div>
            <strong>Notas:</strong>{' '}
            <span className="stat-label">{detailReservation.notes || 'Sin notas registradas.'}</span>
          </div>
        </Modal>
      )}

      {editingReservation && (
        <Modal
          title={`Editar reserva ${editingReservation.confirmation_code}`}
          onClose={() => setEditingReservation(null)}
        >
          <form onSubmit={handleSaveEdit} noValidate>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="edit-res-table">Mesa</label>
                <select
                  id="edit-res-table"
                  value={editTableId}
                  onChange={(e) => setEditTableId(e.target.value)}
                >
                  {data?.tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name} ({t.capacity} pers.)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-party">Comensales</label>
                <input
                  id="edit-res-party"
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={editPartySize}
                  onChange={(e) => setEditPartySize(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-name">Cliente</label>
                <input
                  id="edit-res-name"
                  required
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-email">Correo</label>
                <input
                  id="edit-res-email"
                  type="email"
                  required
                  value={editCustomerEmail}
                  onChange={(e) => setEditCustomerEmail(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-phone">Teléfono</label>
                <input
                  id="edit-res-phone"
                  required
                  value={editCustomerPhone}
                  onChange={(e) => setEditCustomerPhone(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-start">Inicio</label>
                <input
                  id="edit-res-start"
                  type="datetime-local"
                  required
                  value={editStartLocal}
                  onChange={(e) => setEditStartLocal(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-res-end">Fin</label>
                <input
                  id="edit-res-end"
                  type="datetime-local"
                  required
                  value={editEndLocal}
                  onChange={(e) => setEditEndLocal(e.target.value)}
                />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="edit-res-notes">Notas adicionales</label>
              <input
                id="edit-res-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingReservation(null)}
              >
                Cerrar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
