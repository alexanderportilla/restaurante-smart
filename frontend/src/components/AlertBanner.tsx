interface AlertBannerProps {
  variant?: 'error' | 'success' | 'info';
  message: string;
  onDismiss?: () => void;
}

export function AlertBanner({ variant = 'error', message, onDismiss }: AlertBannerProps) {
  const role = variant === 'error' ? 'alert' : 'status';
  return (
    <div className={`alert alert-${variant}`} role={role}>
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
        >
          Cerrar
        </button>
      )}
    </div>
  );
}
