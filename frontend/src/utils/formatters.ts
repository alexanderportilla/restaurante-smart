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
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) {
    return false;
  }

  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@') || atIndex === trimmed.length - 1) {
    return false;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  if (
    localPart.length === 0 ||
    localPart.length > 64 ||
    domainPart.length === 0 ||
    domainPart.length > 253
  ) {
    return false;
  }

  if (
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    domainPart.startsWith('.') ||
    domainPart.endsWith('.') ||
    domainPart.includes('..')
  ) {
    return false;
  }

  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) {
    return false;
  }

  const labelRegex = /^[a-zA-Z0-9-]+$/;
  for (const label of domainLabels) {
    if (!label || label.startsWith('-') || label.endsWith('-') || !labelRegex.test(label)) {
      return false;
    }
  }

  const tld = domainLabels[domainLabels.length - 1];
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    return false;
  }

  const localCharRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  return localCharRegex.test(localPart);
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
