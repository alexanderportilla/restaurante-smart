import { describe, expect, it } from 'vitest';

import {
  defaultDateTimeRange,
  formatCurrency,
  formatDateTime,
  formatOrderType,
  formatStatusLabel,
  isValidEmail,
  toLocalDateTimeInput,
  toUtcIsoString,
} from '../utils/formatters';

describe('formatters and email validation', () => {
  describe('isValidEmail — valid scenarios', () => {
    it('valida correo sencillo estándar', () => {
      expect(isValidEmail('usuario@example.com')).toBe(true);
      expect(isValidEmail('admin@restaurante.smart')).toBe(true);
    });

    it('valida correo con subdominios', () => {
      expect(isValidEmail('contacto@mail.restaurante.ec')).toBe(true);
      expect(isValidEmail('staff@ops.internal.restaurant.com')).toBe(true);
    });

    it('valida correo con caracteres permitidos en parte local (+, ., -, _, etc.)', () => {
      expect(isValidEmail('juan.perez+pedidos@example.com')).toBe(true);
      expect(isValidEmail('cliente_vip-123@domain.co')).toBe(true);
      expect(isValidEmail('c.l.i.e.n.t.e@empresa.com.ec')).toBe(true);
    });

    it('ignora espacios externos gracias al trim', () => {
      expect(isValidEmail('  usuario@example.com  ')).toBe(true);
    });
  });

  describe('isValidEmail — invalid scenarios', () => {
    it('rechaza cadena vacía y solo espacios', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('   ')).toBe(false);
    });

    it('rechaza ausencia de arroba', () => {
      expect(isValidEmail('correosinlocalnidominio')).toBe(false);
      expect(isValidEmail('juan.perez.example.com')).toBe(false);
    });

    it('rechaza ausencia de parte local', () => {
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('  @example.com')).toBe(false);
    });

    it('rechaza ausencia de dominio o sufijo TLD', () => {
      expect(isValidEmail('usuario@')).toBe(false);
      expect(isValidEmail('usuario@domain')).toBe(false);
      expect(isValidEmail('usuario@domain.')).toBe(false);
      expect(isValidEmail('usuario@.com')).toBe(false);
    });

    it('rechaza puntos consecutivos o puntos en extremos', () => {
      expect(isValidEmail('.usuario@example.com')).toBe(false);
      expect(isValidEmail('usuario.@example.com')).toBe(false);
      expect(isValidEmail('usu..ario@example.com')).toBe(false);
      expect(isValidEmail('usuario@example..com')).toBe(false);
    });

    it('rechaza múltiples separadores arroba', () => {
      expect(isValidEmail('usuario@@example.com')).toBe(false);
      expect(isValidEmail('usuario@dos@example.com')).toBe(false);
    });

    it('rechaza TLDs inválidos (menores a 2 caracteres o numéricos)', () => {
      expect(isValidEmail('usuario@domain.c')).toBe(false);
      expect(isValidEmail('usuario@domain.123')).toBe(false);
      expect(isValidEmail('a'.repeat(65) + '@domain.com')).toBe(false);
    });

    it('rechaza etiquetas de dominio con guion inicial o final', () => {
      expect(isValidEmail('usuario@-domain.com')).toBe(false);
      expect(isValidEmail('usuario@domain-.com')).toBe(false);
    });

    it('procesa entradas extremadamente extensas sin bloqueos ni consumo desproporcionado (protección ReDoS)', () => {
      const start = performance.now();

      // Caso 1: entrada muy larga sin arroba
      const longNoAt = 'a'.repeat(50000);
      expect(isValidEmail(longNoAt)).toBe(false);

      // Caso 2: entrada muy larga con arroba pero sin dominio válido
      const longWithAt = 'a'.repeat(25000) + '@' + 'b'.repeat(25000);
      expect(isValidEmail(longWithAt)).toBe(false);

      // Caso 3: entrada con múltiples puntos y arrobas
      const complexMalicious = 'user' + '.@'.repeat(5000) + 'domain.com';
      expect(isValidEmail(complexMalicious)).toBe(false);

      // Caso 4: longitud que excede RFC 5321 (255 caracteres)
      const overRfcLimit = 'a'.repeat(245) + '@domain.com';
      expect(isValidEmail(overRfcLimit)).toBe(false);

      const elapsed = performance.now() - start;
      // Debe completarse en menos de 50 milisegundos sin backtracking exponencial
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('label and data formatters', () => {
    it('formatea tipos de pedido y estados conocidos y fallback a código desconocido', () => {
      expect(formatOrderType('dine_in')).toBe('En mesa');
      expect(formatOrderType('takeaway')).toBe('Para llevar');
      expect(formatOrderType('delivery')).toBe('Domicilio');
      expect(formatOrderType('custom_type')).toBe('custom_type');

      expect(formatStatusLabel('pending')).toBe('Pendiente');
      expect(formatStatusLabel('completed')).toBe('Completada');
      expect(formatStatusLabel('cancelled')).toBe('Cancelado');
      expect(formatStatusLabel('unknown_status')).toBe('unknown_status');
    });

    it('formatea moneda correctamente y maneja valores inválidos', () => {
      const formatted = formatCurrency(12.5);
      expect(formatted).toContain('12,50');
      expect(formatCurrency('25.99')).toContain('25,99');
      expect(formatCurrency('invalido')).toBe('$0.00');
    });

    it('formatea fechas ISO y maneja nulos o valores no válidos', () => {
      expect(formatDateTime(null)).toBe('—');
      expect(formatDateTime(undefined)).toBe('—');
      expect(formatDateTime('')).toBe('—');
      expect(formatDateTime('fecha-invalida')).toBe('fecha-invalida');
      const formatted = formatDateTime('2026-11-17T15:30:00Z');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('convierte fechas locales a ISO y viceversa', () => {
      const iso = toUtcIsoString('2026-11-17T12:00');
      expect(iso).toContain('2026-11-17');

      const localInput = toLocalDateTimeInput('2026-11-17T12:00:00Z');
      expect(localInput).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(toLocalDateTimeInput('invalido')).toBe('');
    });

    it('genera un rango de fechas por defecto coherente', () => {
      const range = defaultDateTimeRange();
      expect(range.startLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(range.endLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
  });
});
