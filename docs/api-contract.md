# Contrato de API REST (`/api/v1`) — Restaurante Smart

La API sigue el estándar OpenAPI 3.1 generado automáticamente por FastAPI (`/api/v1/openapi.json` y `/api/v1/docs`). Todas las respuestas de error comparten un formato JSON unificado:

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "La mesa seleccionada ya tiene una reserva en ese horario.",
    "details": null
  }
}
```

---

## Módulos y Endpoints Planificados

### Salud del Sistema
* `GET /api/v1/health` — Verifica conectividad del servicio y de `postgres-app` (público, usado por Docker healthcheck).

### Autenticación (`/api/v1/auth`)
* `POST /api/v1/auth/register` — Registro de usuario cliente (público; sujeto a rate limiting `429` por proceso).
* `POST /api/v1/auth/login` — Emisión de token JWT Bearer firmado exclusivamente con algoritmos HMAC permitidos (`HS256`, `HS384`, `HS512`; sujeto a rate limiting `429` por proceso).
* `GET /api/v1/auth/me` — Perfil y permisos del usuario autenticado.

### Usuarios y Roles (`/api/v1/users`, `/api/v1/roles`)
* `GET /api/v1/users` — Listado paginado (`admin`, `manager`).
* `POST /api/v1/users` — Crear usuario con rol asignado (`admin`).
* `GET /api/v1/users/{user_id}` — Detalle de usuario (`admin`, `manager` o propio usuario).
* `PATCH /api/v1/users/{user_id}` — Actualizar datos/estado/rol (`admin` para roles; usuario propio para datos básicos).
* `GET /api/v1/roles` — Listar roles y permisos (`admin`, `manager`).

### Categorías y Productos (`/api/v1/categories`, `/api/v1/products`)
* `GET /api/v1/categories` — Listar categorías activas/todas (público/autenticado).
* `POST /api/v1/categories` / `PATCH /api/v1/categories/{id}` / `DELETE /api/v1/categories/{id}` (`admin`, `manager`).
* `GET /api/v1/products` — Catálogo filtrable por categoría, disponibilidad y búsqueda (público para activos; `only_active=false` restringido a `admin` y `manager`).
* `POST /api/v1/products` / `PATCH /api/v1/products/{id}` / `DELETE /api/v1/products/{id}` (`admin`, `manager`).

### Mesas y Disponibilidad (`/api/v1/tables`, `/api/v1/availability`)
* `GET /api/v1/tables` — Listar mesas activas por defecto (`only_active=true`); `only_active=false` restringido a `staff`, `manager` y `admin` (`401`/`403` si no autorizado).
* `GET /api/v1/tables/{id}` — Consultar detalle de una mesa específica (requiere autenticación; mesas inactivas ocultas con `404` para `customer`).
* `POST /api/v1/tables` / `PATCH /api/v1/tables/{id}` (`admin`, `manager`).
* `GET /api/v1/availability` — Consulta disponibilidad por fecha, franja horaria (`start_time`, `end_time`) y número de comensales (`party_size`).

### Reservas (`/api/v1/reservations`)
* `GET /api/v1/reservations` — Listar reservas (propias para `customer`; todas filtrables para `staff`, `manager`, `admin`).
* `POST /api/v1/reservations` — Crear reserva con validación de capacidad, disponibilidad, bloqueo transaccional y notificación automática de confirmación.
* `GET /api/v1/reservations/{id}` — Detalle de reserva (dueño o personal autorizado).
* `PATCH /api/v1/reservations/{id}` — Actualización parcial de reserva no terminal (dueño o personal autorizado), validando capacidad, bloqueo transaccional, no solapamiento (`409`) y notificación automática.
* `PATCH /api/v1/reservations/{id}/status` — Confirmar, completar, cancelar (solo reservas futuras `start_time > ahora`) o marcar `no_show` con notificación automática.

### Pedidos y Seguimiento (`/api/v1/orders`, `/api/v1/order-statuses`)
* `GET /api/v1/order-statuses` — Catálogo de estados de pedido.
* `GET /api/v1/orders` — Listar pedidos (propios para `customer`; operativos filtrables para `staff`, `manager`, `admin`).
* `POST /api/v1/orders` — Crear pedido en línea/mesa dentro de transacción ACID sin `product_id` duplicados, calculando totales en servidor, validando consistencia mesa-reserva (rechaza reservas `cancelled`/`no_show`, hereda `table_id` y asigna propiedad del pedido al cliente dueño de la reserva cuando aplica) y generando notificación automática.
* `GET /api/v1/orders/{id}` — Detalle y seguimiento del pedido (incluye ítems y estado actual).
* `PATCH /api/v1/orders/{id}/status` — Transición validada de estado con notificación automática (`staff`, `manager`, `admin` o cancelación controlada por cliente en estado `pending`).

### Notificaciones (`/api/v1/notifications`)
* `GET /api/v1/notifications` — Bandeja de notificaciones del usuario autenticado.
* `PATCH /api/v1/notifications/{id}/read` — Marcar notificación propia como leída (propiedad estricta del dueño; devuelve `404` para recursos inexistentes o ajenos).

### Reportes (`/api/v1/reports`)
* `GET /api/v1/reports/summary` — KPIs operativos: ventas totales, pedidos por estado, ocupación de mesas y reservas por periodo (`admin`, `manager`).
* `GET /api/v1/reports/top-products` — Productos más vendidos por rango de fechas (`admin`, `manager`).

### Manejo Estándar de Errores y Reglas de Seguridad
* Todas las respuestas de error siguen el formato uniforme `{"error": {"code": "...", "message": "...", "details": ...}}`.
* Códigos principales: `401` (no autenticado / JWT inválido, expirado o algoritmo no autorizado), `403` (sin rol o permiso suficiente / cuenta inactiva), `404` (recurso inexistente o notificación/mesa inactiva fuera de alcance), `409` (duplicidad o conflicto de integridad capturado mediante `IntegrityError` -> `ConflictError` sin exponer SQL), `422` (validación Pydantic, `product_id` duplicado en pedido, cancelación de reserva pasada o violación de regla de negocio), `429` (límite de tasa excedido en `/auth/login` o `/auth/register`, con cabecera `Retry-After`; almacenamiento en memoria por proceso sin coordinación multi-worker) y `500` (error interno controlado sin trazas ni datos sensibles).
* **Limitación conocida:** el modelo `orders` almacena un único `user_id` propietario (separar auditoría de actor `created_by_user_id` frente a cliente dueño requerirá migración Alembic en fase posterior) y los tokens Bearer emitidos en `localStorage` no cuentan con revocación activa en servidor hasta su expiración.
