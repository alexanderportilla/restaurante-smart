# Modelo de Datos Relacional — Restaurante Smart

La base de datos de la aplicación utiliza exclusivamente **PostgreSQL 17** (`postgres-app`). Todas las tablas se administran mediante **Alembic**, utilizando tipos `TIMESTAMPTZ` en UTC para fechas y horas.

---

## 1. Diagrama Entidad-Relación (ERD)

```mermaid
erDiagram
    roles ||--o{ users : "asigna"
    roles ||--o{ role_permissions : "posee"
    permissions ||--o{ role_permissions : "pertenece"
    users ||--o{ reservations : "solicita"
    tables ||--o{ reservations : "ocupa"
    categories ||--o{ products : "agrupa"
    users ||--o{ orders : "realiza"
    tables ||--o{ orders : "asocia (opcional)"
    reservations ||--o{ orders : "vincula (opcional)"
    order_statuses ||--o{ orders : "clasifica"
    orders ||--o{ order_items : "contiene"
    products ||--o{ order_items : "detalla"
    users ||--o{ notifications : "recibe"

    roles {
        int id PK
        string code UK
        string name
        string description
        timestamptz created_at
        timestamptz updated_at
    }

    permissions {
        int id PK
        string code UK
        string description
        timestamptz created_at
    }

    users {
        uuid id PK
        int role_id FK
        string full_name
        string email UK
        string phone
        string password_hash
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    tables {
        int id PK
        string code UK
        string name
        int capacity
        string location
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    reservations {
        uuid id PK
        uuid user_id FK
        int table_id FK
        string customer_name
        string customer_email
        string customer_phone
        int party_size
        timestamptz start_time
        timestamptz end_time
        string status
        string confirmation_code UK
        text notes
        timestamptz created_at
        timestamptz updated_at
    }

    categories {
        int id PK
        string name UK
        string slug UK
        string description
        int display_order
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    products {
        int id PK
        int category_id FK
        string name
        string sku UK
        text description
        numeric price
        int preparation_minutes
        boolean is_available
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    order_statuses {
        int id PK
        string code UK
        string name
        int sort_order
        boolean is_terminal
    }

    orders {
        uuid id PK
        string order_number UK
        uuid user_id FK
        int table_id FK
        uuid reservation_id FK
        int status_id FK
        string order_type
        numeric subtotal
        numeric tax_amount
        numeric total_amount
        text notes
        timestamptz confirmed_at
        timestamptz created_at
        timestamptz updated_at
    }

    order_items {
        int id PK
        uuid order_id FK
        int product_id FK
        int quantity
        numeric unit_price
        numeric line_total
        string special_instructions
    }

    notifications {
        uuid id PK
        uuid user_id FK
        string channel
        string event_type
        string title
        text message
        string reference_type
        uuid reference_id
        string status
        boolean is_read
        timestamptz sent_at
        timestamptz created_at
    }
```

---

## 2. Reglas de Integridad, Restricciones e Índices

### Seguridad e Identidad (`roles`, `permissions`, `role_permissions`, `users`)
* `users.email` único e indexado en minúsculas.
* `users.password_hash` almacenado con Argon2id (nunca texto plano).
* `role_permissions` con clave primaria compuesta `(role_id, permission_id)` y eliminación en cascada controlada.

### Mesas y Reservas (`tables`, `reservations`)
* `tables.capacity > 0` (`CHECK`).
* `reservations.party_size > 0` (`CHECK`).
* `reservations.end_time > reservations.start_time` (`CHECK`).
* `reservations.status` restringido a valores válidos: `pending`, `confirmed`, `completed`, `cancelled`, `no_show`.
* **Restricción anti-solapamiento (PostgreSQL `btree_gist`):**
  ```sql
  ALTER TABLE reservations
  ADD CONSTRAINT uq_reservations_no_overlap
  EXCLUDE USING gist (
      table_id WITH =,
      tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'));
  ```
  Esto garantiza a nivel de motor de base de datos que dos reservas activas nunca puedan superponerse en la misma mesa, incluso bajo peticiones concurrentes.
* Índices en `(table_id, start_time, end_time)`, `user_id`, `status` y `confirmation_code`.

### Catálogo y Pedidos (`categories`, `products`, `order_statuses`, `orders`, `order_items`)
* `products.price >= 0` (`CHECK`), tipo `NUMERIC(10, 2)` (evita errores de punto flotante).
* `orders.order_type` restringido a: `dine_in`, `takeaway`, `delivery`.
* `orders.subtotal >= 0`, `orders.tax_amount >= 0`, `orders.total_amount >= 0` (`CHECK`).
* `order_items.quantity > 0`, `unit_price >= 0`, `line_total >= 0` (`CHECK`), índice por `order_id`.
* `orders.table_id` y `orders.reservation_id` anulables (un pedido para llevar/domicilio no requiere mesa).

### Notificaciones (`notifications`)
* `channel`: `in_app`, `email_simulated`.
* `status`: `pending`, `sent`, `failed`.
* Índice compuesto `(user_id, is_read, created_at DESC)` para bandeja rápida del usuario.
