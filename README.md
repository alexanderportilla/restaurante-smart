# Restaurante Smart

Sistema integral para la gestión de reservas, disponibilidad de mesas, pedidos en línea, confirmaciones automáticas y analítica operativa de un restaurante, desarrollado con una arquitectura modular e integración de calidad y CI/CD local.

---

## Stack Tecnológico

* **Backend:** Python `3.13.18`, FastAPI `0.163.1`, Pydantic `2.14.3`, SQLAlchemy `2.1.8`, Alembic `1.20.1`, Psycopg `3.3.9`, `pwdlib[argon2]`, `PyJWT`, Pytest `9.2.0`, Ruff `0.17.5`.
* **Frontend:** Node.js `22.23.1`, React `19.3.1`, TypeScript `5.9.3`, React Router `8.5.1`, Vite `8.3.8`, Axios `1.21.1`, Vitest `5.1.0`, Testing Library, ESLint `10.15.0`, Nginx `1.28.1`.
* **Base de Datos:** PostgreSQL `17.12` (único motor soportado; dos instancias independientes para aplicación y SonarQube).
* **DevOps y Calidad:** Docker Engine `29.9.3`, Docker Compose `v5.7.1`, Jenkins `2.580.2-lts-jdk21` + agente aislado sin socket Docker, SonarQube Community Build `26.11.0`, SonarScanner CLI `8.4.0`. *(Portainer permanece aplazado hasta contar con acceso sin socket Docker directo).*

---

## Requisitos Previos

* **Para ejecución local sin contenedores:** Python `3.13.18` (recomendado con `uv`), Node.js `22.23+` y `npm`, PostgreSQL `17` con extensión `btree_gist`.
* **Para ejecución en contenedores:** Docker Engine y Docker Compose v2+.

---

## Estructura del Repositorio

```text
restaurante-smart/
├── backend/                  # API FastAPI modular, modelos SQLAlchemy 2, migraciones Alembic y tests Pytest
├── frontend/                 # SPA React + TypeScript + Vite, cliente Axios, Nginx con CSP y tests Vitest
├── jenkins/                  # Dockerfile del agente aislado (JDK21/Py3.13/Node22/SonarScanner) y preparación .ci-workspace
├── database/                 # Documentación de instancias PostgreSQL y migraciones Alembic
├── docs/                     # Documentación de arquitectura, modelo de datos y contrato API
├── tests/                    # Guía consolidada de ubicación y ejecución de pruebas
├── docker-compose.yml        # Perfiles app, quality y ci (sin Docker socket y con Portainer retirado)
├── .env.example              # Plantilla de variables de entorno (sin secretos reales)
├── .gitignore / .dockerignore
├── Jenkinsfile               # Pipeline declarativo CI/CD en 14 etapas
└── sonar-project.properties  # Configuración SonarQube (projectKey: restaurante-smart)
```

---

## Preparación de Variables de Entorno

```bash
cp .env.example .env
```

Editar `.env` reemplazando todos los valores `CHANGE_ME_*` con contraseñas fuertes y una clave JWT aleatoria de al menos 64 caracteres hexadecimales:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

> Nunca versionar `.env` ni compartir credenciales reales. En arranque normal (`APP_ENV != "test"`), FastAPI valida `JWT_SECRET_KEY` durante su inicialización (`lifespan`) y rechaza iniciar si faltan o usan valores de plantilla.

---

## Ejecución Local (Desarrollo)

### 1. Backend y Migraciones Alembic

```bash
cd backend
uv sync --frozen --group dev

# Aplicar migraciones sobre PostgreSQL configurado en .env
uv run --no-sync alembic upgrade head

# Levantar API en desarrollo
uv run --no-sync uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm ci
npm run dev
```

El proxy de desarrollo de Vite redirige `/api` hacia `http://localhost:8000`.

---

## Ejecución de Pruebas y Linting

```bash
# Backend
cd backend
uv run --no-sync ruff check app tests migrations
uv run --no-sync ruff format --check app tests
uv run --no-sync pytest --cov=app --cov-report=term-missing
# Para ejecutar también las pruebas integrales reales contra PostgreSQL en una BD aislada:
# RUN_POSTGRES_TESTS=1 TEST_DATABASE_URL=postgresql+psycopg://... uv run --no-sync pytest

# Frontend
cd ../frontend
npm run lint
npm run typecheck
npm run test:coverage
npm run build
# E2E Chromium: requiere PostgreSQL aislado restaurante_smart_test y Google Chrome.
npm run test:e2e
```

---

## Uso con Docker Compose y Consideraciones de PostgreSQL

Los servicios publican sus puertos exclusivamente en `127.0.0.1`:

| Servicio | Puerto local | Perfil |
| :--- | :--- | :--- |
| Frontend (Nginx + React SPA) | `http://127.0.0.1:3000` | `app` |
| Backend (FastAPI) | `http://127.0.0.1:8000` | `app` |
| PostgreSQL Aplicación (`postgres-app`) | `127.0.0.1:5432` | `app` |
| SonarQube Community Build | `http://127.0.0.1:9000` | `quality` |
| Jenkins LTS | `http://127.0.0.1:8080` | `ci` |

### Advertencia crítica sobre `postgres-app` existente

En el entorno del proyecto donde `postgres-app` ya fue inicializado externamente mediante `docker run` sobre el volumen `postgres_app_data`, **no ejecutes `docker compose --profile app up -d` ni `docker compose down -v`** porque Compose intentaría recrear o colisionar con el contenedor de base de datos existente.

* Para recrear o actualizar únicamente `backend` y `frontend` preservando `postgres-app` intacto:
  ```bash
  docker compose up -d --no-deps backend frontend
  ```
* Para desplegar SonarQube (perfil `quality`) o Jenkins aislado (perfil `ci`):
  ```bash
  ./jenkins/prepare-workspace.sh   # Prepara .ci-workspace/ sin .env ni secretos locales
  docker compose --profile quality up -d
  docker compose --profile ci up -d
  ```

---

## Limitaciones Actuales de CI/CD y Seguridad

* **Construcción de imágenes Docker en Jenkins (Etapa 13):** Permanece pendiente/documentada porque Jenkins y su agente operan sin acceso a `/var/run/docker.sock` ni contenedores privilegiados (`Opción B`).
* **Pruebas PostgreSQL en CI:** El agente de Jenkins ejecuta las pruebas unitarias, de seguridad y de endpoints sin conexión a `postgres-app`; las pruebas reales PostgreSQL (`RUN_POSTGRES_TESTS=1`) se ejecutan de forma controlada fuera del agente aislado.
* **Almacenamiento JWT en Frontend:** El cliente utiliza token Bearer en `localStorage` protegido por una política `CSP` estricta sin `script-src 'unsafe-inline'` ni `'unsafe-eval'`. Como mejora futura puede migrarse a cookies `HttpOnly; SameSite=Lax` modificando backend, CORS y pruebas.
* **Configuración Jenkins pendiente de sincronización:** El job existente conserva una configuración inline que debe sincronizarse con el `Jenkinsfile` versionado durante una ventana autorizada. Esta auditoría no ejecuta pipelines ni modifica servicios o credenciales.

---

## Documentación Técnica

* [Arquitectura del Sistema y Seguridad](docs/architecture.md)
* [Modelo de Datos Relacional](docs/data-model.md)
* [Contrato de API REST (`/api/v1`)](docs/api-contract.md)
* [Base de Datos y Migraciones](database/README.md)
* [Pruebas Automatizadas](tests/README.md)

## Licencia

Pendiente de definición por el propietario del proyecto.
