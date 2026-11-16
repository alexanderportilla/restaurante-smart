import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { AlertBanner } from '../components/AlertBanner';
import { useAuth } from '../hooks/useAuth';
import { extractApiError } from '../services/httpClient';

export function LoginPage() {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password) {
      setError('Ingresa tu correo electrónico y contraseña.');
      return;
    }

    if (mode === 'register' && fullName.trim().length < 2) {
      setError('El nombre completo debe tener al menos 2 caracteres.');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email: email.trim(), password });
        navigate(redirectTo, { replace: true });
      } else {
        await register({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
        });
        setSuccess('Cuenta creada correctamente. Ahora puedes iniciar sesión.');
        setMode('login');
        setPassword('');
      }
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Restaurante Smart</h1>
          <p>
            {mode === 'login'
              ? 'Inicia sesión para gestionar reservas, disponibilidad y pedidos.'
              : 'Crea una cuenta de cliente para reservar mesas y pedir en línea.'}
          </p>
        </div>

        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        {success && (
          <AlertBanner variant="success" message={success} onDismiss={() => setSuccess(null)} />
        )}

        <form onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <>
              <div className="form-field">
                <label htmlFor="fullName">Nombre completo</label>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej. María Fernanda López"
                />
              </div>
              <div className="form-field">
                <label htmlFor="phone">Teléfono (opcional)</label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0999999999"
                />
              </div>
            </>
          )}

          <div className="form-field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@restaurante.com"
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
            {submitting
              ? 'Procesando...'
              : mode === 'login'
                ? 'Iniciar sesión'
                : 'Registrar cuenta'}
          </button>
        </form>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setMode((prev) => (prev === 'login' ? 'register' : 'login'));
              setError(null);
              setSuccess(null);
            }}
          >
            {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </div>
    </div>
  );
}
