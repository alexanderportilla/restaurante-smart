# Restaurante Smart

Sistema integral para la gestión de reservas, disponibilidad de mesas, pedidos en línea, confirmaciones automáticas y analítica operativa de un restaurante, construido con una arquitectura modular y preparado para integración continua y despliegue con GitHub, Docker, Jenkins, SonarQube y Portainer.

## Stack Tecnológico

* **Backend:** Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, Psycopg 3, Pytest, HTTPX, Ruff.
* **Frontend:** React 19, TypeScript 5, Vite, React Router 7, Vitest, Testing Library, Nginx.
* **Bases de Datos:** PostgreSQL 17 (dos instancias independientes: aplicación y SonarQube).
* **DevOps y Calidad:** Docker, Docker Compose, Jenkins LTS (JDK 21), SonarQube Community Build (`26.x`), Portainer CE LTS.

## Estructura del Repositorio

```text
restaurante-smart/
├── backend/                  # API REST modular FastAPI, modelos SQLAlchemy 2, migraciones Alembic y tests
├── frontend/                 # SPA React + TypeScript + Vite, cliente HTTP tipado y tests Vitest
├── database/                 # Documentación de instancias PostgreSQL, esquema y políticas de migración
├── docs/                     # Documentación técnica de arquitectura, modelo de datos, API y DevOps
├── tests/                    # Pruebas de integración del stack y smoke tests E2E
├── docker-compose.yml        # Orquestación unificada (perfiles app y devops)
├── .env.example              # Plantilla de variables de entorno (sin secretos reales)
├── .gitignore                # Exclusiones de Git
├── Jenkinsfile               # Pipeline declarativo CI/CD
└── sonar-project.properties  # Configuración única de análisis SonarQube (clave: restaurante-smart)
```

## Documentación Técnica

* [Arquitectura del Sistema y Matriz de Servicios](docs/architecture.md)
* [Modelo de Datos Relacional](docs/data-model.md)
* [Contrato de API REST (`/api/v1`)](docs/api-contract.md)
* [Base de Datos y Migraciones](database/README.md)
* [Pruebas Integrales del Stack](tests/README.md)

## Estado del Proyecto

Proyecto desarrollado de forma incremental por fases controladas. Consulte la documentación en `docs/` para revisar las especificaciones de arquitectura, base de datos y contratos antes de ejecutar los servicios.
