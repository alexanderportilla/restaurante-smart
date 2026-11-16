const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  preparing: { label: 'En preparación', tone: 'warning' },
  ready: { label: 'Listo', tone: 'success' },
  delivered: { label: 'Entregado', tone: 'success' },
  completed: { label: 'Completada', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  no_show: { label: 'No asistió', tone: 'neutral' },
  active: { label: 'Activo', tone: 'success' },
  inactive: { label: 'Inactivo', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, tone: 'neutral' };
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>;
}
