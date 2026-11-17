import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { reportsService } from '../services/reportsService';
import { formatCurrency, toUtcIsoString } from '../utils/formatters';

export function ReportsPage() {
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [appliedRange, setAppliedRange] = useState<{ from_date?: string; to_date?: string }>({});

  const fetchReports = useCallback(async () => {
    const [summary, topProducts] = await Promise.all([
      reportsService.getSummary(appliedRange),
      reportsService.getTopProducts(appliedRange, 10),
    ]);
    return { summary, topProducts };
  }, [appliedRange]);

  const { data, isLoading, error } = useAsyncResource(fetchReports);

  function handleApplyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilterError(null);
    if (fromLocal && toLocal && new Date(toLocal) < new Date(fromLocal)) {
      setFilterError('La fecha final no puede ser anterior a la fecha inicial.');
      return;
    }
    setAppliedRange({
      from_date: fromLocal ? toUtcIsoString(fromLocal) : undefined,
      to_date: toLocal ? toUtcIsoString(toLocal) : undefined,
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reportes Operativos</h1>
          <p className="page-subtitle">Indicadores de ventas, pedidos, reservas y productos top.</p>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {filterError && (
        <AlertBanner variant="error" message={filterError} onDismiss={() => setFilterError(null)} />
      )}

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <form onSubmit={handleApplyFilter}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="rep-from">Desde</label>
              <input
                id="rep-from"
                type="datetime-local"
                value={fromLocal}
                onChange={(e) => setFromLocal(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="rep-to">Hasta</label>
              <input
                id="rep-to"
                type="datetime-local"
                value={toLocal}
                onChange={(e) => setToLocal(e.target.value)}
              />
            </div>
          </div>
          <div className="actions-row">
            <button type="submit" className="btn btn-primary">
              Aplicar rango
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setFromLocal('');
                setToLocal('');
                setAppliedRange({});
              }}
            >
              Limpiar
            </button>
          </div>
        </form>
      </section>

      {isLoading ? (
        <LoadingState label="Calculando reportes..." />
      ) : (
        data && (
          <>
            <div className="grid-cards">
              <div className="card">
                <div className="stat-label">Ingresos totales</div>
                <div className="stat-value">{formatCurrency(data.summary.total_revenue)}</div>
              </div>
              <div className="card">
                <div className="stat-label">Total de pedidos</div>
                <div className="stat-value">{data.summary.total_orders}</div>
              </div>
              <div className="card">
                <div className="stat-label">Reservas en rango</div>
                <div className="stat-value">{data.summary.total_reservations}</div>
              </div>
              <div className="card">
                <div className="stat-label">Mesas activas</div>
                <div className="stat-value">{data.summary.active_tables}</div>
              </div>
            </div>

            <div className="grid-two">
              <section className="card">
                <h2>Pedidos por estado</h2>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Estado</th>
                        <th>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.summary.orders_by_status.map((item) => (
                        <tr key={item.status_code}>
                          <td>{item.status_name}</td>
                          <td>{item.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <h2>Productos más vendidos</h2>
                {data.topProducts.items.length === 0 ? (
                  <p className="empty-state">Sin ventas registradas en el rango seleccionado.</p>
                ) : (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Producto</th>
                          <th>Unidades</th>
                          <th>Ingresos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topProducts.items.map((item) => (
                          <tr key={item.product_id}>
                            <td>{item.sku}</td>
                            <td>{item.product_name}</td>
                            <td>{item.total_quantity}</td>
                            <td>{formatCurrency(item.total_revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
