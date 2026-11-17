# Pruebas Automatizadas — Restaurante Smart

Actualmente no existen scripts E2E independientes dentro de la carpeta `tests/`. Todas las pruebas automatizadas e integrales implementadas residen en los módulos de backend y frontend:

## 1. Backend (`backend/tests/`)

* `test_core_security.py`: hashing Argon2id, firma/expiración JWT, validación de configuración y arranque seguro de FastAPI.
* `test_migrations.py`: estructura de revisiones Alembic (`0001_initial_schema` y `0002_align_unique_indexes`), extensión `btree_gist` y exclusión anti-solapamiento `uq_reservations_no_overlap`.
* `test_api_endpoints.py`: contratos REST `/api/v1`, códigos de estado y RBAC sobre dependencias en memoria.
* `test_services_business_rules.py`: reglas de negocio de reservas, pedidos, cálculo decimal y notificaciones.
* `test_security_rbac_and_edge_cases.py`: JWT inválidos/expirados/tipo erróneo, `require_permissions`, matriz RBAC negativa, `GET /tables/{id}`, `PATCH /reservations/{id}`, colisiones en actualización de catálogo, auto-protección de `admin`, consistencia pedido-reserva, aislamiento de notificaciones y enmascarado de `500`.
* `test_phase18_security_hardening.py`: rate limiting `/auth/login` y `/auth/register` (`429`), validación de `TRUSTED_PROXY_IPS`, autorización `GET /tables`/`GET /tables/{id}`/`GET /products`, `IntegrityError` -> `409`, allowlist `JWT_ALGORITHM`, propiedad estricta de notificaciones (`404`), unicidad de `product_id` y propiedad en pedidos, y bloqueo de cancelación de reservas pasadas.
* `test_postgres_integration.py` y `test_full_flows_postgres.py`: pruebas integrales reales contra PostgreSQL 17.12 (requieren `RUN_POSTGRES_TESTS=1` y una base de datos de pruebas aislada en `TEST_DATABASE_URL`, bloqueando explícitamente `restaurante_smart`; en CI o entornos sin BD de pruebas aislada se omiten de forma controlada).

```bash
cd backend
uv run --no-sync ruff check app tests migrations
uv run --no-sync ruff format --check app tests
uv run --no-sync pytest --cov=app --cov-report=term-missing
```

## 2. Frontend (`frontend/src/test/`)

Pruebas con **Vitest 5.1.0**, **Testing Library** y **jsdom**:

* `httpClient.test.ts`: interceptores Axios, manejo de errores `ApiClientError` y limpieza ante `401`.
* `LoginPage.test.tsx`: validación de formulario, inicio de sesión, registro y redirección.
* `RoutesAndRBAC.test.tsx`: rutas protegidas por rol (`admin`, `manager`, `staff`, `customer`).
* `CatalogAndTablesPages.test.tsx`, `DashboardNotificationsReports.test.tsx`, `ReservationsAndOrders.test.tsx`: cobertura funcional de páginas de negocio.
* `Phase15FullFlows.test.tsx`: cobertura integral de timeouts `408`, detalles `422`, limpieza de sesión inválida, RBAC `staff`/`manager`/`customer`, detalle y edición en `TablesPage`, `ReservationsPage`, `CatalogPage`, `OrdersPage`, `UsersPage`, `ProfilePage` y validaciones de `ReportsPage`.

```bash
cd frontend
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

## 3. E2E Chromium (`frontend/e2e/`)

La suite Playwright prueba los flujos funcionales y responsive contra un backend efímero y
la base aislada `restaurante_smart_test` (localhost:5433). Requiere el contenedor PostgreSQL
de pruebas, el entorno Python `backend/.venv` y Google Chrome en `/usr/bin/google-chrome`.
La suite crea y elimina únicamente datos sintéticos identificados por ejecución; no apunta a
`restaurante_smart`.

```bash
cd frontend
npm run test:e2e
```

Los reportes y capturas predeterminados se guardan bajo `frontend/e2e-results/`, excluida
de Git y del contexto Docker. Se puede dirigir las capturas a otro directorio mediante
`E2E_SCREENSHOT_DIR=/ruta/alternativa`.
