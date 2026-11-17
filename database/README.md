# Base de Datos — Restaurante Smart

## Regla de Instancias Independientes

La infraestructura utiliza **exclusivamente PostgreSQL 17 (`17.12-alpine3.24`)** distribuido en **dos instancias completamente aisladas**:

1. **`postgres-app` (Red `app_network`):** Base de datos transaccional de Restaurante Smart (`restaurante_smart`), expuesta únicamente en `127.0.0.1:5432` y respaldada por el volumen externo `postgres_app_data`.
2. **`postgres-sonar` (Red `devops_network`):** Base de datos exclusiva para SonarQube Community Build (`sonarqube`), configurada con codificación `UTF-8` y volumen propio `postgres_sonar_data`.

No se utiliza MySQL, MariaDB ni H2 en ningún entorno, y ambas instancias mantienen credenciales, volúmenes y redes independientes.

## Operación Segura de `postgres-app`

En el entorno anfitrión actual, `postgres-app` fue inicializado de forma independiente mediante `docker run` preservando `postgres_app_data`. **No ejecutes `docker compose --profile app up -d` de forma indiscriminada** ni `docker compose down -v`, ya que Compose podría intentar recrear o colisionar con el contenedor existente. Para actualizar solo la aplicación sin tocar PostgreSQL:

```bash
docker compose up -d --no-deps backend frontend
```

## Gestión de Esquema y Migraciones

* Todas las tablas, índices, restricciones `CHECK` y exclusiones `EXCLUDE USING gist` (extensión `btree_gist`) se crean y actualizan **exclusivamente mediante Alembic** desde `backend/migrations/`.
* No se permite crear o alterar tablas manualmente fuera del flujo de migraciones versionadas.
* Todas las columnas temporales utilizan `TIMESTAMP WITH TIME ZONE` (`TIMESTAMPTZ`) almacenando fechas en UTC.

## Comandos Operativos

```bash
cd backend

# Verificar estado actual de migración
uv run --no-sync alembic current

# Aplicar migraciones pendientes
uv run --no-sync alembic upgrade head

# Generar nueva migración tras cambios en modelos
uv run --no-sync alembic revision --autogenerate -m "descripcion_del_cambio"
```
