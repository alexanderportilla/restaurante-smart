import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { usersService } from '../services/usersService';

export function UsersPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const fetchUsersAndRoles = useCallback(async () => {
    const [usersPage, roles] = await Promise.all([
      usersService.listUsers(50, 0),
      usersService.listRoles(),
    ]);
    return { usersPage, roles };
  }, []);

  const { data, isLoading, error, reload } = useAsyncResource(fetchUsersAndRoles);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [roleCode, setRoleCode] = useState('staff');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    if (fullName.trim().length < 2 || !email.trim() || password.length < 8) {
      setActionError('Verifica nombre (mín. 2), correo válido y contraseña (mín. 8 caracteres).');
      return;
    }

    setSaving(true);
    try {
      await usersService.createUser({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        role_code: roleCode,
        is_active: true,
      });
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setActionSuccess('Usuario creado correctamente.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: string) {
    setActionError(null);
    setActionSuccess(null);
    try {
      await usersService.updateUser(userId, { role_code: nextRole });
      setActionSuccess('Rol actualizado correctamente.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    setActionError(null);
    setActionSuccess(null);
    try {
      await usersService.updateUser(userId, { is_active: !currentActive });
      setActionSuccess('Estado de cuenta actualizado.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    }
  }

  if (isLoading) {
    return <LoadingState label="Cargando usuarios y roles..." />;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Usuarios, Roles y Permisos</h1>
          <p className="page-subtitle">Administración de cuentas y control RBAC del sistema.</p>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {actionError && (
        <AlertBanner variant="error" message={actionError} onDismiss={() => setActionError(null)} />
      )}
      {actionSuccess && (
        <AlertBanner
          variant="success"
          message={actionSuccess}
          onDismiss={() => setActionSuccess(null)}
        />
      )}

      {isAdmin && (
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>Crear usuario</h2>
          <form onSubmit={handleCreateUser}>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="u-name">Nombre completo</label>
                <input
                  id="u-name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="u-email">Correo electrónico</label>
                <input
                  id="u-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="u-phone">Teléfono</label>
                <input
                  id="u-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="u-pass">Contraseña inicial</label>
                <input
                  id="u-pass"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="u-role">Rol</label>
                <select
                  id="u-role"
                  value={roleCode}
                  onChange={(e) => setRoleCode(e.target.value)}
                >
                  {data?.roles.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : 'Crear usuario'}
            </button>
          </form>
        </section>
      )}

      {data && (
        <div className="grid-two">
          <section className="card">
            <h2>Usuarios ({data.usersPage.total})</h2>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    {isAdmin && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.usersPage.items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.full_name}</td>
                      <td>{u.email}</td>
                      <td>
                        {isAdmin ? (
                          <select
                            aria-label={`Rol de ${u.full_name}`}
                            value={u.role.code}
                            onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                          >
                            {data.roles.map((r) => (
                              <option key={r.id} value={r.code}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          u.role.name
                        )}
                      </td>
                      <td>
                        <StatusBadge status={u.is_active ? 'active' : 'inactive'} />
                      </td>
                      {isAdmin && (
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void handleToggleActive(u.id, u.is_active)}
                          >
                            {u.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Roles y permisos</h2>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rol</th>
                    <th>Permisos asignados</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roles.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <strong>{role.name}</strong>
                        <div className="stat-label">{role.code}</div>
                      </td>
                      <td>
                        {role.permissions.length === 0 ? (
                          <span className="stat-label">Acceso propio de cliente</span>
                        ) : (
                          <div className="actions-row">
                            {role.permissions.map((perm) => (
                              <span key={perm.id} className="badge badge-neutral">
                                {perm.code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
