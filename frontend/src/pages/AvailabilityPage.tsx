import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { extractApiError } from '../services/httpClient';
import { tablesService } from '../services/tablesService';
import type { AvailabilityResponse } from '../types/api';
import { defaultDateTimeRange, formatDateTime, toUtcIsoString } from '../utils/formatters';

export function AvailabilityPage() {
  const navigate = useNavigate();
  const defaults = defaultDateTimeRange();

  const [startLocal, setStartLocal] = useState(defaults.startLocal);
  const [endLocal, setEndLocal] = useState(defaults.endLocal);
  const [partySize, setPartySize] = useState('2');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AvailabilityResponse | null>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!startLocal || !endLocal) {
      setError('Selecciona fecha y hora de inicio y fin.');
      return;
    }

    const partyCount = Number(partySize);
    if (!Number.isInteger(partyCount) || partyCount < 1 || partyCount > 50) {
      setError('El número de comensales debe estar entre 1 y 50.');
      return;
    }

    const startIso = toUtcIsoString(startLocal);
    const endIso = toUtcIsoString(endLocal);
    if (new Date(endIso) <= new Date(startIso)) {
      setError('La hora de fin debe ser posterior a la hora de inicio.');
      return;
    }

    setLoading(true);
    try {
      const response = await tablesService.checkAvailability(startIso, endIso, partyCount);
      setResult(response);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Disponibilidad de Mesas</h1>
          <p className="page-subtitle">
            Consulta mesas libres en tiempo real evitando solapamientos de horario.
          </p>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <form onSubmit={handleSearch}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="avail-start">Inicio</label>
              <input
                id="avail-start"
                type="datetime-local"
                required
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="avail-end">Fin</label>
              <input
                id="avail-end"
                type="datetime-local"
                required
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="avail-party">Comensales</label>
              <input
                id="avail-party"
                type="number"
                min="1"
                max="50"
                required
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Consultando...' : 'Buscar mesas disponibles'}
          </button>
        </form>
      </section>

      {result && (
        <section className="card">
          <h2>
            Mesas disponibles ({result.available_tables.length}) — {result.party_size} personas
          </h2>
          <p className="page-subtitle" style={{ marginBottom: '1rem' }}>
            Franja: {formatDateTime(result.start_time)} hasta {formatDateTime(result.end_time)}
          </p>

          {result.available_tables.length === 0 ? (
            <p className="empty-state">No existen mesas disponibles para esa franja y capacidad.</p>
          ) : (
            <div className="grid-cards">
              {result.available_tables.map((table) => (
                <article key={table.id} className="card">
                  <h3>
                    {table.name} ({table.code})
                  </h3>
                  <p className="stat-label">Ubicación: {table.location}</p>
                  <p className="stat-label">Capacidad: {table.capacity} personas</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      navigate('/reservations', {
                        state: {
                          tableId: table.id,
                          startLocal,
                          endLocal,
                          partySize: Number(partySize),
                        },
                      })
                    }
                  >
                    Reservar esta mesa
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
