import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { tablesService } from '../services/tablesService';
import type { RestaurantTable } from '../types/api';
import { formatDateTime } from '../utils/formatters';

export function TablesPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin', 'manager');

  const fetchTables = useCallback(() => tablesService.listTables(false), []);
  const { data: tables, isLoading, error, reload } = useAsyncResource(fetchTables);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [location, setLocation] = useState('Salón principal');
  const [submitting, setSubmitting] = useState(false);
  const [busyTableId, setBusyTableId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [detailTable, setDetailTable] = useState<RestaurantTable | null>(null);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('4');
  const [editLocation, setEditLocation] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editSubmitting, setEditSubmitting] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const cap = Number(capacity);
    if (!code.trim() || name.trim().length < 2 || !Number.isInteger(cap) || cap < 1 || cap > 50) {
      setFeedback({
        type: 'error',
        text: 'Completa código, nombre (mín. 2 caracteres) y capacidad entera entre 1 y 50.',
      });
      return;
    }

    setSubmitting(true);
    try {
      await tablesService.createTable({
        code: code.trim(),
        name: name.trim(),
        capacity: cap,
        location: location.trim() || 'Salón principal',
        is_active: true,
      });
      setCode('');
      setName('');
      setCapacity('4');
      setFeedback({ type: 'success', text: 'Mesa creada correctamente.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewDetail(tableId: number) {
    setFeedback(null);
    setBusyTableId(tableId);
    try {
      const detail = await tablesService.getTable(tableId);
      setDetailTable(detail);
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyTableId(null);
    }
  }

  function openEditModal(table: RestaurantTable) {
    setEditingTable(table);
    setEditCode(table.code);
    setEditName(table.name);
    setEditCapacity(String(table.capacity));
    setEditLocation(table.location);
    setEditActive(table.is_active);
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTable) {
      return;
    }
    setFeedback(null);
    const cap = Number(editCapacity);
    if (
      !editCode.trim() ||
      editName.trim().length < 2 ||
      editLocation.trim().length < 2 ||
      !Number.isInteger(cap) ||
      cap < 1 ||
      cap > 50
    ) {
      setFeedback({
        type: 'error',
        text: 'Verifica código, nombre, ubicación (mín. 2 caracteres) y capacidad (1-50).',
      });
      return;
    }

    setEditSubmitting(true);
    try {
      await tablesService.updateTable(editingTable.id, {
        code: editCode.trim(),
        name: editName.trim(),
        capacity: cap,
        location: editLocation.trim(),
        is_active: editActive,
      });
      setEditingTable(null);
      setFeedback({ type: 'success', text: 'Mesa actualizada correctamente.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function toggleActive(tableId: number, currentActive: boolean) {
    setFeedback(null);
    setBusyTableId(tableId);
    try {
      await tablesService.updateTable(tableId, { is_active: !currentActive });
      setFeedback({ type: 'success', text: 'Estado de mesa actualizado.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyTableId(null);
    }
  }

  if (isLoading) {
    return <LoadingState label="Cargando mesas..." />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Gestión de Mesas</h1>
          <p className="page-subtitle">Distribución de espacios, capacidad y habilitación.</p>
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

      {canManage && (
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>Registrar nueva mesa</h2>
          <form onSubmit={handleCreate} noValidate>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="t-code">Código</label>
                <input
                  id="t-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="M-01"
                />
              </div>
              <div className="form-field">
                <label htmlFor="t-name">Nombre</label>
                <input
                  id="t-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mesa Ventana 1"
                />
              </div>
              <div className="form-field">
                <label htmlFor="t-cap">Capacidad</label>
                <input
                  id="t-cap"
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="t-loc">Ubicación</label>
                <input
                  id="t-loc"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Guardando...' : 'Agregar mesa'}
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Mesas registradas ({tables?.length ?? 0})</h2>
        {!tables || tables.length === 0 ? (
          <p className="empty-state">No hay mesas registradas.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Ubicación</th>
                  <th>Capacidad</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((table) => (
                  <tr key={table.id}>
                    <td>
                      <strong>{table.code}</strong>
                    </td>
                    <td>{table.name}</td>
                    <td>{table.location}</td>
                    <td>{table.capacity} personas</td>
                    <td>
                      <StatusBadge status={table.is_active ? 'active' : 'inactive'} />
                    </td>
                    <td>
                      <div className="actions-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyTableId === table.id}
                          onClick={() => void handleViewDetail(table.id)}
                        >
                          Detalle
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busyTableId === table.id}
                              onClick={() => openEditModal(table)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busyTableId === table.id}
                              onClick={() => void toggleActive(table.id, table.is_active)}
                            >
                              {table.is_active ? 'Deshabilitar' : 'Habilitar'}
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
        )}
      </section>

      {detailTable && (
        <Modal
          title={`Mesa ${detailTable.code} — ${detailTable.name}`}
          onClose={() => setDetailTable(null)}
        >
          <dl className="detail-list">
            <div>
              <dt>ID interno</dt>
              <dd>{detailTable.id}</dd>
            </div>
            <div>
              <dt>Capacidad</dt>
              <dd>{detailTable.capacity} personas</dd>
            </div>
            <div>
              <dt>Ubicación</dt>
              <dd>{detailTable.location}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <StatusBadge status={detailTable.is_active ? 'active' : 'inactive'} />
              </dd>
            </div>
            <div>
              <dt>Creada</dt>
              <dd>{formatDateTime(detailTable.created_at)}</dd>
            </div>
            <div>
              <dt>Última actualización</dt>
              <dd>{formatDateTime(detailTable.updated_at)}</dd>
            </div>
          </dl>
        </Modal>
      )}

      {editingTable && (
        <Modal
          title={`Editar mesa ${editingTable.code}`}
          onClose={() => setEditingTable(null)}
        >
          <form onSubmit={handleSaveEdit} noValidate>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="edit-t-code">Código</label>
                <input
                  id="edit-t-code"
                  required
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-t-name">Nombre</label>
                <input
                  id="edit-t-name"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-t-cap">Capacidad</label>
                <input
                  id="edit-t-cap"
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-t-loc">Ubicación</label>
                <input
                  id="edit-t-loc"
                  required
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                />
              </div>
            </div>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              <span>Mesa activa para reservas</span>
            </label>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingTable(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
