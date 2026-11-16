interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Cargando información...' }: LoadingStateProps) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <p>{label}</p>
    </div>
  );
}
