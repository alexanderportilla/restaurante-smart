import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ConsoleMessage, type Page, type Response } from '@playwright/test';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(CURRENT_DIR, '..');
const REPO_ROOT = resolve(FRONTEND_DIR, '..');
const PYTHON_BIN = resolve(REPO_ROOT, 'backend', '.venv', 'bin', 'python');
const DB_HELPER = resolve(CURRENT_DIR, 'db-helper.py');
const SCREENSHOT_DIR = resolve(
  process.env.E2E_SCREENSHOT_DIR ?? resolve(FRONTEND_DIR, 'e2e-results', 'screenshots'),
);

const RUN_ID = `${Date.now().toString(36).slice(-5)}`;
const E2E_PASS = 'E2eTestPass123!';

interface SeededUser {
  id: string;
  email: string;
  full_name: string;
  role_code: 'admin' | 'manager' | 'staff' | 'customer';
}

type SeededUsers = Record<'admin' | 'manager' | 'staff' | 'customer', SeededUser>;

function runDbHelper(args: string[]): string {
  return execFileSync(PYTHON_BIN, [DB_HELPER, ...args], {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
  }).trim();
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

async function uiLogout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe.serial('Fase 22 — Suite E2E Chromium contra PostgreSQL aislado', () => {
  let users: SeededUsers;
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const unexpectedConsoleErrors: string[] = [];

  function attachMonitors(page: Page, allowHttpStatuses: number[] = []): void {
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (!txt.includes('Failed to load resource: the server responded with a status of 40')) {
          unexpectedConsoleErrors.push(txt);
        }
      }
    });
    page.on('response', (res: Response) => {
      const status = res.status();
      if (status >= 500) {
        serverErrors.push(`${status} ${res.url()}`);
      } else if (
        status >= 400 &&
        res.url().includes('/assets/') &&
        !allowHttpStatuses.includes(status)
      ) {
        serverErrors.push(`ASSET_${status} ${res.url()}`);
      }
    });
  }

  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const verifyOut = JSON.parse(runDbHelper(['verify'])) as {
      database: string;
      user: string;
      alembic_version: string;
    };
    expect(verifyOut.database).toBe('restaurante_smart_test');
    expect(verifyOut.user).toBe('restaurante_test_user');
    expect(verifyOut.alembic_version).toBe('0002_align_unique_indexes');

    users = JSON.parse(runDbHelper(['seed', RUN_ID, E2E_PASS])) as SeededUsers;
  });

  test.afterAll(() => {
    const cleanupOut = JSON.parse(runDbHelper(['cleanup', RUN_ID])) as {
      run_id: string;
      deleted: Record<string, number>;
    };
    expect(cleanupOut.run_id).toBe(RUN_ID);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]);
  });

  test('Bloque 1 y 2 — Carga inicial, validaciones, registro, login, persistencia y logout', async ({
    page,
  }) => {
    attachMonitors(page, [401]);

    // Redirección de ruta protegida sin sesión
    await page.goto('/reservations');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Restaurante Smart' })).toBeVisible();

    // Validación de campos vacíos
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Ingresa tu correo electrónico y contraseña.',
    );

    // Validación de formato de correo inválido
    await page.getByLabel('Correo electrónico').fill('correo-invalido');
    await page.getByLabel('Contraseña').fill('Password123!');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Ingresa un correo electrónico con formato válido.',
    );

    // Credenciales incorrectas -> 401
    await page.getByLabel('Correo electrónico').fill(users.customer.email);
    await page.getByLabel('Contraseña').fill('WrongPassword999!');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // Registro de nuevo cliente temporal desde el formulario
    const regEmail = `e2e_reg_${RUN_ID}@example.com`;
    await page.getByRole('button', { name: '¿No tienes cuenta? Regístrate' }).click();
    await page.getByLabel('Nombre completo').fill(`E2E_${RUN_ID} Registro`);
    await page.getByLabel('Teléfono (opcional)').fill('0991112233');
    await page.getByLabel('Correo electrónico').fill(regEmail);
    await page.getByLabel('Contraseña').fill(E2E_PASS);
    await page.getByRole('button', { name: 'Registrar cuenta' }).click();
    await expect(page.getByRole('status')).toContainText('Cuenta creada correctamente');

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-login-register.png'), fullPage: true });

    // Login con la cuenta recién registrada: vuelve a la ruta protegida original (/reservations) y persiste tras reload
    await page.getByLabel('Contraseña').fill(E2E_PASS);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/reservations$/);
    await expect(
      page.getByRole('heading', { name: 'Calendario y Gestión de Reservas' }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Calendario y Gestión de Reservas' }),
    ).toBeVisible();

    // Logout y bloqueo posterior en ruta protegida
    await uiLogout(page);
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('Bloque 3 — Control de acceso RBAC UI + coherencia backend en los 4 roles', async ({
    page,
  }) => {
    attachMonitors(page, [403]);

    // 1. Customer: sin Mesas, Reportes ni Usuarios
    await uiLogin(page, users.customer.email, E2E_PASS);
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Mesas' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Usuarios y Roles' })).toHaveCount(0);

    for (const restrictedPath of ['/tables', '/reports', '/users']) {
      await page.goto(restrictedPath);
      await expect(page.getByRole('alert')).toContainText('Acceso restringido');
    }

    // Coherencia backend 403 con el JWT del customer
    const customerReportStatus = await page.evaluate(async () => {
      const token = window.localStorage.getItem('rs_access_token');
      const res = await fetch('/api/v1/reports/summary', {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      return res.status;
    });
    expect(customerReportStatus).toBe(403);
    await uiLogout(page);

    // 2. Staff: accede a Mesas (solo lectura/operación), bloqueado en Reportes y Usuarios
    await uiLogin(page, users.staff.email, E2E_PASS);
    await expect(nav.getByRole('link', { name: 'Mesas' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Usuarios y Roles' })).toHaveCount(0);
    await page.goto('/tables');
    await expect(page.getByRole('heading', { name: 'Gestión de Mesas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Registrar nueva mesa' })).toHaveCount(0);
    await page.goto('/reports');
    await expect(page.getByRole('alert')).toContainText('Acceso restringido');
    const staffReportStatus = await page.evaluate(async () => {
      const token = window.localStorage.getItem('rs_access_token');
      const res = await fetch('/api/v1/reports/summary', {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      return res.status;
    });
    expect(staffReportStatus).toBe(403);
    await uiLogout(page);

    // 3. Manager: acceso a Mesas, Reportes y Usuarios
    await uiLogin(page, users.manager.email, E2E_PASS);
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Usuarios y Roles' })).toBeVisible();
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reportes Operativos' })).toBeVisible();
    await uiLogout(page);

    // 4. Admin: acceso completo
    await uiLogin(page, users.admin.email, E2E_PASS);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Usuarios, Roles y Permisos' })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-admin-users-rbac.png'), fullPage: true });
    await uiLogout(page);
  });

  test('Bloque 4 — Módulos Usuarios, Mesas, Catálogo y Perfil', async ({ page }) => {
    attachMonitors(page);

    // Admin gestiona usuario temporal E2E en /users
    await uiLogin(page, users.admin.email, E2E_PASS);
    await page.goto('/users');
    const extraEmail = `e2e_extra_${RUN_ID}@example.com`;
    await page.getByLabel('Nombre completo').fill(`E2E_${RUN_ID} Extra`);
    await page.getByLabel('Correo electrónico').fill(extraEmail);
    await page.getByLabel('Teléfono').fill('0995556677');
    await page.locator('#u-pass').fill(E2E_PASS);
    await page.locator('#u-role').selectOption('customer');
    await page.getByRole('button', { name: 'Crear usuario' }).click();
    await expect(page.getByText(extraEmail)).toBeVisible();

    const extraRow = page.locator('tr', { hasText: extraEmail });
    await extraRow.getByRole('button', { name: 'Detalle' }).click();
    await expect(page.getByRole('dialog')).toContainText(extraEmail);
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar ventana' }).click();

    await extraRow.getByRole('button', { name: 'Desactivar' }).click();
    await expect(extraRow.getByRole('button', { name: 'Activar' })).toBeVisible();
    await uiLogout(page);

    // Manager crea mesa, categoría y producto temporales
    await uiLogin(page, users.manager.email, E2E_PASS);
    await page.goto('/tables');
    const tableCode = `E2E-${RUN_ID}-T1`;
    await page.getByLabel('Código').fill(tableCode);
    await page.getByLabel('Nombre').fill(`E2E_${RUN_ID} Mesa Terraza`);
    await page.getByLabel('Capacidad').fill('4');
    await page.getByLabel('Ubicación').fill('Terraza Norte');
    await page.getByRole('button', { name: 'Agregar mesa' }).click();
    await expect(page.getByText(tableCode)).toBeVisible();

    const tableRow = page.locator('tr', { hasText: tableCode });
    await tableRow.getByRole('button', { name: 'Editar' }).click();
    await page.locator('#edit-t-loc').fill('Terraza VIP');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(tableRow).toContainText('Terraza VIP');

    // Categoría y producto en /catalog
    await page.goto('/catalog');
    const catName = `E2E_${RUN_ID} Platos`;
    const catSlug = `e2e-${RUN_ID}-platos`;
    await page.locator('#cat-name').fill(catName);
    await page.locator('#cat-slug').fill(catSlug);
    await page.locator('#cat-order').fill('1');
    await page.locator('#cat-desc').fill('Categoría temporal E2E');
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    await expect(page.locator('#prod-cat')).toContainText(catName);

    const prodName = `E2E_${RUN_ID} Ceviche`;
    const prodSku = `E2E-${RUN_ID}-P1`;
    await page.locator('#prod-name').fill(prodName);
    await page.locator('#prod-sku').fill(prodSku);
    await page.locator('#prod-cat').selectOption({ label: catName });
    await page.locator('#prod-price').fill('14.50');
    await page.locator('#prod-prep').fill('12');
    await page.locator('#prod-desc').fill('Plato de prueba E2E');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText(prodSku)).toBeVisible();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-catalog-created.png'), fullPage: true });
    await uiLogout(page);

    // Customer actualiza su perfil en /profile
    await uiLogin(page, users.customer.email, E2E_PASS);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Mi Perfil y Seguridad' })).toBeVisible();
    await page.locator('#profile-name').fill(`E2E_${RUN_ID} Cliente Actualizado`);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Perfil actualizado');
    await uiLogout(page);
  });

  test('Bloque 5 — Disponibilidad, reservas, solapamiento y cancelación/completado', async ({
    page,
  }) => {
    attachMonitors(page, [409]);

    const start1 = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start1.setMinutes(0, 0, 0);
    const end1 = new Date(start1.getTime() + 2 * 60 * 60 * 1000);

    const start2 = new Date(start1.getTime() + 4 * 60 * 60 * 1000);
    const end2 = new Date(start2.getTime() + 2 * 60 * 60 * 1000);

    await uiLogin(page, users.customer.email, E2E_PASS);

    // Consultar disponibilidad y saltar al formulario de reservas
    await page.goto('/availability');
    await page.locator('#avail-start').fill(toLocalDateTimeInput(start1));
    await page.locator('#avail-end').fill(toLocalDateTimeInput(end1));
    await page.locator('#avail-party').fill('2');
    await page.getByRole('button', { name: 'Buscar mesas disponibles' }).click();

    const tableCard = page.locator('article.card', { hasText: `E2E-${RUN_ID}-T1` });
    await expect(tableCard).toBeVisible();
    await tableCard.getByRole('button', { name: 'Reservar esta mesa' }).click();
    await expect(page).toHaveURL(/\/reservations$/);

    // Crear reserva 1
    await page.locator('#res-phone').fill('0997778899');
    await page.locator('#res-notes').fill(`E2E_${RUN_ID} Ventana`);
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.locator('.alert-success')).toContainText('Reserva confirmada');

    // Probar solapamiento en la misma mesa y misma franja -> 409 Conflict
    await page.locator('#res-start').fill(toLocalDateTimeInput(start1));
    await page.locator('#res-end').fill(toLocalDateTimeInput(end1));
    await page.locator('#res-phone').fill('0997778899');
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.locator('.alert-error')).toBeVisible();

    // Crear reserva 2 en franja libre y cancelarla como cliente
    await page.locator('#res-start').fill(toLocalDateTimeInput(start2));
    await page.locator('#res-end').fill(toLocalDateTimeInput(end2));
    await page.locator('#res-notes').fill(`E2E_${RUN_ID} Cancelable`);
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.locator('.alert-success')).toContainText('Reserva confirmada');

    const cancelButtons = page.getByRole('button', { name: 'Cancelar' });
    await cancelButtons.last().click();
    await expect(page.locator('tbody .badge', { hasText: 'Cancelado' }).first()).toBeVisible();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-reservations-overlap.png'), fullPage: true });
    await uiLogout(page);

    // Staff completa la reserva 1 confirmada
    await uiLogin(page, users.staff.email, E2E_PASS);
    await page.goto('/reservations');
    const completeBtn = page.getByRole('button', { name: 'Completar' }).first();
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();
    await expect(page.locator('tbody .badge', { hasText: 'Completada' }).first()).toBeVisible();
    await uiLogout(page);
  });

  test('Bloque 6 — Pedidos, transiciones de estado, notificaciones y reportes', async ({
    page,
  }) => {
    attachMonitors(page);

    const prodName = `E2E_${RUN_ID} Ceviche`;

    await uiLogin(page, users.customer.email, E2E_PASS);
    await page.goto('/orders');

    // Validación de pedido sin productos
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page.getByRole('alert')).toContainText('Agrega al menos un producto al pedido.');

    // Selección de producto, cantidad, nota e instrucciones
    await page.getByLabel(`Cantidad de ${prodName}`).fill('2');
    await page.getByLabel(`Nota para ${prodName}`).fill('Sin cilantro');
    await page.locator('#ord-notes').fill(`E2E_${RUN_ID} Pedido`);
    await expect(page.getByText('Resumen previo (1 productos)')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();

    await expect(page.locator('.alert-success')).toContainText('Pedido');
    const customerOrdersSection = page.locator('section.card', {
      hasText: 'Seguimiento de pedidos',
    });
    const orderRow = customerOrdersSection.locator('tbody tr', { hasText: prodName }).first();
    await expect(orderRow).toBeVisible();
    await uiLogout(page);

    // Staff avanza el pedido por todas sus transiciones válidas: pending -> confirmed -> preparing -> ready -> delivered
    await uiLogin(page, users.staff.email, E2E_PASS);
    await page.goto('/orders');
    const staffOrdersSection = page.locator('section.card', {
      hasText: 'Seguimiento de pedidos',
    });
    const staffOrderRow = staffOrdersSection.locator('tbody tr', { hasText: prodName }).first();
    for (const actionLabel of ['Confirmar', 'Preparar', 'Marcar listo', 'Entregar']) {
      await staffOrderRow.getByRole('button', { name: actionLabel }).click();
      await expect(page.locator('.alert-success')).toContainText('actualizado a');
    }
    await expect(staffOrderRow).toContainText('Entregado');
    await uiLogout(page);

    // Customer revisa notificaciones y marca una como leída
    await uiLogin(page, users.customer.email, E2E_PASS);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notificaciones Automáticas' })).toBeVisible();
    const markReadBtn = page.getByRole('button', { name: 'Marcar leída' }).first();
    await expect(markReadBtn).toBeVisible();
    await markReadBtn.click();
    await expect(page.getByText('Leída').first()).toBeVisible();
    await uiLogout(page);

    // Manager verifica Dashboard y Reportes con ingresos del pedido entregado
    await uiLogin(page, users.manager.email, E2E_PASS);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reportes Operativos' })).toBeVisible();
    await expect(page.getByText(prodName)).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Panel Principal' })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '05-orders-and-dashboard.png'), fullPage: true });
    await uiLogout(page);
  });

  test('Bloque 7 — Responsive móvil (390x844), sin desbordamiento horizontal ni errores JS', async ({
    page,
  }) => {
    attachMonitors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await uiLogin(page, users.customer.email, E2E_PASS);

    for (const route of ['/', '/catalog', '/availability', '/orders']) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow, `Desbordamiento horizontal detectado en ${route}`).toBe(false);
    }

    // Abrir y cerrar menú móvil accesible
    const menuBtn = page.getByRole('button', { name: 'Abrir menú de navegación' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await expect(page.getByRole('button', { name: 'Cerrar menú' })).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '06-mobile-menu.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await uiLogout(page);
  });
});
