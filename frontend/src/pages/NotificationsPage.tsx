import { useCallback, useState } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { extractApiError } from '../services/httpClient';
import { notificationsService } from '../services/notificationsService';
import { formatDateTime } from '../utils/formatters';

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchNotifications = useCallback(
    () => notificationsService.listNotifications(unreadOnly, 50, 0),
    [unreadOnly],
  );

  const { data, isLoading, error, reload } = useAsyncResource(fetchNotifications);

  async function handleMarkRead(notificationId: string) {
    setActionError(null);
    try {
      await notificationsService.markAsRead(notificationId);
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Notificaciones Automáticas</h1>
          <p className="page-subtitle">
            Confirmaciones de reservas y actualizaciones de estado de pedidos.
          </p>
        </div>
        <label className="form-checkbox" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          <span>Mostrar solo no leídas</span>
        </label>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {actionError && (
        <AlertBanner variant="error" message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {isLoading ? (
        <LoadingState label="Cargando notificaciones..." />
      ) : !data || data.items.length === 0 ? (
        <div className="card empty-state">No hay notificaciones en tu bandeja.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {data.items.map((item) => (
            <article key={item.id} className="card">
              <div className="page-header" style={{ marginBottom: '0.35rem' }}>
                <div>
                  <strong>{item.title}</strong>
                  <div className="stat-label">{formatDateTime(item.created_at)}</div>
                </div>
                <div className="actions-row">
                  <span className={`badge ${item.is_read ? 'badge-neutral' : 'badge-info'}`}>
                    {item.is_read ? 'Leída' : 'Nueva'}
                  </span>
                  {!item.is_read && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleMarkRead(item.id)}
                    >
                      Marcar leída
                    </button>
                  )}
                </div>
              </div>
              <p style={{ margin: 0 }}>{item.message}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
