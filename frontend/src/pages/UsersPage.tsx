import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { Modal } from '../components/Modal';
import { PaginationControls } from '../components/PaginationControls';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';
import { usersService } from '../services/usersService';
import type { UserRecord } from '../types/api';
import { formatDateTime, isValidEmail } from '../utils/formatters';

const PAGE_LIMIT = 50;

export function UsersPage() {
  const { user: currentUser, hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const fetchUsersAndRoles = useCallback(async () => {
    const [usersPage, roles] = await Promise.all([
      usersService.listUsers(PAGE_LIMIT, offset),
      usersService.listRoles(),
    ]);
    return { usersPage, roles };
  }, [offset]);

  const { data, isLoading, error, reload } = useAsyncResource(fetchUsersAndRoles);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [roleCode, setRoleCode] = useState('staff');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [detailUser, setDetailUser] = useState<UserRecord | null>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRoleCode, setEditRoleCode] = useState('customer');
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    if (fullName.trim().length < 2 || !isValidEmail(email) || password.length < 8) {
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

  async function handleViewDetail(userId: string) {
    setActionError(null);
    setBusyUserId(userId);
    try {
      const detail = await usersService.getUser(userId);
      setDetailUser(detail);
    } catch (err) {
      setActionError(extractApiError(err).message);
    } finally {
      setBusyUserId(null);
    }
  }

  function openEditModal(target: UserRecord) {
    setEditingUser(target);
    setEditFullName(target.full_name);
    setEditPhone(target.phone ?? '');
    setEditRoleCode(target.role.code);
    setEditActive(target.is_active);
    setEditPassword('');
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);

    if (editFullName.trim().length < 2) {
      setActionError('El nombre completo debe tener al menos 2 caracteres.');
      return;
    }
    if (editPassword && editPassword.length < 8) {
      setActionError('La contraseña opcional debe tener al menos 8 caracteres.');
      return;
    }

    setSavingEdit(true);
    try {
      await usersService.updateUser(editingUser.id, {
        full_name: editFullName.trim(),
        phone: editPhone.trim(),
        role_code: editRoleCode,
        is_active: editActive,
        password: editPassword || undefined,
      });
      setEditingUser(null);
      setActionSuccess('Usuario actualizado correctamente.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: string) {
    setActionError(null);
    setActionSuccess(null);
    setBusyUserId(userId);
    try {
      await usersService.updateUser(userId, { role_code: nextRole });
      setActionSuccess('Rol actualizado correctamente.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    setActionError(null);
    setActionSuccess(null);
    setBusyUserId(userId);
    try {
      await usersService.updateUser(userId, { is_active: !currentActive });
      setActionSuccess('Estado de cuenta actualizado.');
      await reload();
    } catch (err) {
      setActionError(extractApiError(err).message);
    } finally {
      setBusyUserId(null);
    }
  }

  const filteredUsers = (data?.usersPage.items ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.name.toLowerCase().includes(q);
    const matchesRole = !roleFilter || u.role.code === roleFilter;
    return matchesSearch && matchesRole;
  });

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
          <form onSubmit={handleCreateUser} noValidate>
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
        <>
          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="form-grid">
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label htmlFor="u-search">Buscar en página</label>
                <input
                  id="u-search"
                  placeholder="Nombre o correo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label htmlFor="u-role-filter">Filtrar por rol</label>
                <select
                  id="u-role-filter"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">Todos los roles</option>
                  {data.roles.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

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
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const isSelf = currentUser?.id === u.id;
                      const isBusy = busyUserId === u.id;
                      return (
                        <tr key={u.id}>
                          <td>
                            {u.full_name}{' '}
                            {isSelf && <span className="badge badge-info">Tu cuenta</span>}
                          </td>
                          <td>{u.email}</td>
                          <td>
                            {isAdmin ? (
                              <select
                                aria-label={`Rol de ${u.full_name}`}
                                value={u.role.code}
                                disabled={isSelf || isBusy}
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
                          <td>
                            <div className="actions-row">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={isBusy}
                                onClick={() => void handleViewDetail(u.id)}
                              >
                                Detalle
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={isBusy}
                                    onClick={() => openEditModal(u)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={isSelf || isBusy}
                                    onClick={() => void handleToggleActive(u.id, u.is_active)}
                                  >
                                    {u.is_active ? 'Desactivar' : 'Activar'}
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
              <PaginationControls
                total={data.usersPage.total}
                limit={PAGE_LIMIT}
                offset={offset}
                onPageChange={setOffset}
              />
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
        </>
      )}

      {detailUser && (
        <Modal title={`Usuario: ${detailUser.full_name}`} onClose={() => setDetailUser(null)}>
          <dl className="detail-list">
            <div>
              <dt>Correo</dt>
              <dd>{detailUser.email}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{detailUser.phone || 'No registrado'}</dd>
            </div>
            <div>
              <dt>Rol</dt>
              <dd>
                {detailUser.role.name} ({detailUser.role.code})
              </dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <StatusBadge status={detailUser.is_active ? 'active' : 'inactive'} />
              </dd>
            </div>
            <div>
              <dt>Creado</dt>
              <dd>{formatDateTime(detailUser.created_at)}</dd>
            </div>
            <div>
              <dt>Actualizado</dt>
              <dd>{formatDateTime(detailUser.updated_at)}</dd>
            </div>
          </dl>
        </Modal>
      )}

      {editingUser && (
        <Modal title={`Editar usuario: ${editingUser.email}`} onClose={() => setEditingUser(null)}>
          <form onSubmit={handleSaveEdit} noValidate>
            <div className="form-field">
              <label htmlFor="edit-u-name">Nombre completo</label>
              <input
                id="edit-u-name"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="edit-u-phone">Teléfono</label>
                <input
                  id="edit-u-phone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-u-role">Rol</label>
                <select
                  id="edit-u-role"
                  disabled={currentUser?.id === editingUser.id}
                  value={editRoleCode}
                  onChange={(e) => setEditRoleCode(e.target.value)}
                >
                  {data?.roles.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="edit-u-pass">Nueva contraseña (opcional)</label>
              <input
                id="edit-u-pass"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <label className="form-checkbox">
              <input
                type="checkbox"
                disabled={currentUser?.id === editingUser.id}
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              <span>Cuenta activa</span>
            </label>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                {savingEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingUser(null)}
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
