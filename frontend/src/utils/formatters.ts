const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'En mesa',
  takeaway: 'Para llevar',
  delivery: 'Domicilio',
};

const STATUS_DISPLAY_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  completed: 'Completada',
  cancelled: 'Cancelado',
  no_show: 'No asistió',
};

export function formatOrderType(orderType: string): string {
  return ORDER_TYPE_LABELS[orderType] ?? orderType;
}

export function formatStatusLabel(statusCode: string): string {
  return STATUS_DISPLAY_LABELS[statusCode] ?? statusCode;
}

export function formatCurrency(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
  }).format(numeric);
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) {
    return '—';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function toUtcIsoString(localDateTimeValue: string): string {
  const date = new Date(localDateTimeValue);
  return date.toISOString();
}

export function toLocalDateTimeInput(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function defaultDateTimeRange(): { startLocal: string; endLocal: string } {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const toLocalInput = (d: Date) => {
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  };
  return { startLocal: toLocalInput(start), endLocal: toLocalInput(end) };
}
