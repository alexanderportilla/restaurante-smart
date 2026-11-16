from pydantic import BaseModel, ConfigDict


class ORMBaseSchema(BaseModel):
    """Base para esquemas serializados desde modelos ORM."""

    model_config = ConfigDict(from_attributes=True)


class PaginatedResponse[T](BaseModel):
    """Respuesta estándar paginada."""

    items: list[T]
    total: int
    limit: int
    offset: int


class HealthResponse(BaseModel):
    """Estado de salud del servicio y la base de datos."""

    status: str
    service: str
    database: str
