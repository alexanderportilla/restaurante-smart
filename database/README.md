# Base de Datos — Restaurante Smart

## Regla de Instancias Independientes

La infraestructura utiliza **exclusivamente PostgreSQL 17** distribuido en **dos instancias completamente aisladas**:

1. **`postgres-app` (Red `app_network`):** Base de datos transaccional de Restaurante Smart (`restaurante_smart`).
2. **`postgres-sonar` (Red `devops_network`):** Base de datos exclusiva para SonarQube Community Build (`sonarqube`), configurada con codificación `UTF-8`.

No se utiliza MySQL, MariaDB ni H2 en ningún entorno, y ambas instancias mantienen credenciales, volúmenes (`postgres_app_data` y `postgres_sonar_data`) y redes independientes.

## Gestión de Esquema y Migraciones

* Todas las tablas, índices, restricciones `CHECK` y exclusiones `EXCLUDE USING gist` (extensión `btree_gist`) se crean y actualizan **exclusivamente mediante Alembic** desde `backend/migrations/`.
* No se permite crear o alterar tablas manualmente fuera del flujo de migraciones versionadas.
* Todas las columnas temporales utilizan `TIMESTAMP WITH TIME ZONE` (`TIMESTAMPTZ`) almacenando fechas en UTC.

## Comandos Operativos (disponibles a partir de Fase 6)

```bash
# Aplicar migraciones pendientes
alembic upgrade head

# Verificar estado actual de migración
alembic current

# Generar nueva migración tras cambios en modelos
alembic revision --autogenerate -m "descripcion_del_cambio"
```
