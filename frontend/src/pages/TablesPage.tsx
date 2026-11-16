import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { tablesService } from '../services/tablesService';

export function TablesPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin', 'manager');

  const fetchTables = useCallback(() => tablesService.listTables(false), []);
  const { data: tables, isLoading, error, reload } = useAsyncResource(fetchTables);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [location, setLocation] = useState('Salón principal');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const cap = Number(capacity);
    if (!code.trim() || !name.trim() || cap <= 0) {
      setFeedback({ type: 'error', text: 'Completa código, nombre y capacidad válida (> 0).' });
      return;
    }

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
      setFeedback({ type: 'success', text: 'Mesa creada correctamente.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  async function toggleActive(tableId: number, currentActive: boolean) {
    setFeedback(null);
    try {
      await tablesService.updateTable(tableId, { is_active: !currentActive });
      setFeedback({ type: 'success', text: 'Estado de mesa actualizado.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
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
          <form onSubmit={handleCreate}>
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
            <button type="submit" className="btn btn-primary">
              Agregar mesa
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
                  {canManage && <th>Acciones</th>}
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
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => void toggleActive(table.id, table.is_active)}
                        >
                          {table.is_active ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
