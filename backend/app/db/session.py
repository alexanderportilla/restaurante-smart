from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """Crea y cachea el motor SQLAlchemy hacia PostgreSQL."""
    settings = get_settings()
    return create_engine(
        settings.sqlalchemy_database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


def get_session_factory() -> sessionmaker[Session]:
    """Devuelve una fábrica de sesiones enlazada al motor configurado."""
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


def get_db() -> Generator[Session]:
    """Dependencia FastAPI que provee una sesión de base de datos por petición."""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
