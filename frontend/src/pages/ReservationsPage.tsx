import { useCallback, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { reservationsService } from '../services/reservationsService';
import { tablesService } from '../services/tablesService';
import type { Reservation, ReservationStatus } from '../types/api';
import { defaultDateTimeRange, formatDateTime, toUtcIsoString } from '../utils/formatters';

interface PreselectState {
  tableId?: number;
  startLocal?: string;
  endLocal?: string;
  partySize?: number;
}

export function ReservationsPage() {
  const { user, hasRole } = useAuth();
  const isStaffOrHigher = hasRole('admin', 'manager', 'staff');
  const location = useLocation();
  const preselect = (location.state as PreselectState | null) ?? {};
  const defaults = defaultDateTimeRange();

  const [statusFilter, setStatusFilter] = useState<ReservationStatus | ''>('');

  const loadData = useCallback(async () => {
    const [reservations, tables] = await Promise.all([
      reservationsService.listReservations({
        status: statusFilter || undefined,
        limit: 50,
      }),
      tablesService.listTables(true),
    ]);
    return { reservations, tables };
  }, [statusFilter]);

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
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function handleCreateReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const selectedTableId = Number(tableId || data?.tables[0]?.id);
    if (!selectedTableId || !customerName.trim() || !customerEmail.trim() || !customerPhone.trim()) {
      setFeedback({ type: 'error', text: 'Completa todos los datos requeridos de la reserva.' });
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
        party_size: Number(partySize) || 1,
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

  async function handleStatusChange(reservationId: string, nextStatus: ReservationStatus) {
    setFeedback(null);
    try {
      await reservationsService.updateStatus(reservationId, nextStatus);
      setFeedback({ type: 'success', text: `Reserva actualizada a ${nextStatus}.` });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
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
        <form onSubmit={handleCreateReservation}>
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
        <div className="form-field" style={{ maxWidth: '280px', marginBottom: 0 }}>
          <label htmlFor="res-filter">Filtrar por estado</label>
          <select
            id="res-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReservationStatus | '')}
          >
            <option value="">Todos los estados</option>
            <option value="confirmed">Confirmada</option>
            <option value="pending">Pendiente</option>
            <option value="completed">Completada</option>
            <option value="cancelled">Cancelada</option>
            <option value="no_show">No asistió</option>
          </select>
        </div>
      </section>

      {isLoading ? (
        <LoadingState label="Cargando agenda de reservas..." />
      ) : Object.keys(groupedByDate).length === 0 ? (
        <div className="card empty-state">No hay reservas registradas para el filtro actual.</div>
      ) : (
        Object.entries(groupedByDate).map(([day, items]) => (
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
                  {items.map((res) => (
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
                          {(res.status === 'pending' || res.status === 'confirmed') && (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => void handleStatusChange(res.id, 'cancelled')}
                            >
                              Cancelar
                            </button>
                          )}
                          {isStaffOrHigher && res.status === 'confirmed' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => void handleStatusChange(res.id, 'completed')}
                              >
                                Completar
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => void handleStatusChange(res.id, 'no_show')}
                              >
                                No asistió
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
