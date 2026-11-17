import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { usersService } from '../services/usersService';

export function ProfilePage() {
  const { user, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  if (!user) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      return;
    }
    setFeedback(null);

    if (fullName.trim().length < 2) {
      setFeedback({
        type: 'error',
        text: 'El nombre completo debe tener al menos 2 caracteres.',
      });
      return;
    }

    if (newPassword && newPassword.length < 8) {
      setFeedback({
        type: 'error',
        text: 'La nueva contraseña debe tener al menos 8 caracteres.',
      });
      return;
    }

    setSaving(true);
    try {
      await usersService.updateUser(user.id, {
        full_name: fullName.trim(),
        phone: phone.trim(),
        password: newPassword || undefined,
      });
      await refreshProfile();
      setNewPassword('');
      setFeedback({ type: 'success', text: 'Perfil actualizado correctamente.' });
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mi Perfil y Seguridad</h1>
          <p className="page-subtitle">
            Consulta tus datos personales, rol activo y accesos rápidos de tu cuenta.
          </p>
        </div>
        <div className="actions-row">
          <Link to="/reservations" className="btn btn-secondary">
            Mis reservas
          </Link>
          <Link to="/orders" className="btn btn-secondary">
            Mis pedidos
          </Link>
          <Link to="/notifications" className="btn btn-secondary">
            Notificaciones
          </Link>
        </div>
      </div>

      {feedback && (
        <AlertBanner
          variant={feedback.type}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="grid-two">
        <section className="card">
          <h2>Datos de la cuenta</h2>
          <dl className="detail-list">
            <div>
              <dt>Correo electrónico</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Rol asignado</dt>
              <dd>
                {user.role_name} ({user.role_code})
              </dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <StatusBadge status={user.is_active ? 'active' : 'inactive'} />
              </dd>
            </div>
            <div>
              <dt>Permisos efectivos</dt>
              <dd>
                {user.permissions.length === 0 ? (
                  <span className="stat-label">Operaciones de cliente autenticado</span>
                ) : (
                  <div className="actions-row">
                    {user.permissions.map((perm) => (
                      <span key={perm} className="badge badge-neutral">
                        {perm}
                      </span>
                    ))}
                  </div>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>Actualizar mis datos</h2>
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="profile-name">Nombre completo</label>
              <input
                id="profile-name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="profile-phone">Teléfono</label>
              <input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0999999999"
              />
            </div>
            <div className="form-field">
              <label htmlFor="profile-pass">Nueva contraseña (opcional)</label>
              <input
                id="profile-pass"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres para cambiarla"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
