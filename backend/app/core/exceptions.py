from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Excepción base de dominio para respuestas HTTP controladas."""

    def __init__(
        self,
        message: str,
        code: str = "APP_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    """Recurso no encontrado."""

    def __init__(self, message: str = "Recurso no encontrado.", details: Any = None) -> None:
        super().__init__(
            message=message,
            code="RESOURCE_NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
            details=details,
        )


class ConflictError(AppError):
    """Conflicto de estado o unicidad (p. ej. reserva solapada)."""

    def __init__(self, message: str = "Conflicto de integridad.", details: Any = None) -> None:
        super().__init__(
            message=message,
            code="RESOURCE_CONFLICT",
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


class UnauthorizedError(AppError):
    """Credenciales inválidas o sesión expirada."""

    def __init__(self, message: str = "No autenticado.", details: Any = None) -> None:
        super().__init__(
            message=message,
            code="UNAUTHORIZED",
            status_code=status.HTTP_401_UNAUTHORIZED,
            details=details,
        )


class ForbiddenError(AppError):
    """Usuario autenticado sin permisos suficientes."""

    def __init__(
        self,
        message: str = "No tiene permisos para esta acción.",
        details: Any = None,
    ) -> None:
        super().__init__(
            message=message,
            code="FORBIDDEN",
            status_code=status.HTTP_403_FORBIDDEN,
            details=details,
        )


class BusinessRuleError(AppError):
    """Incumplimiento de una regla de negocio."""

    def __init__(
        self,
        message: str,
        code: str = "BUSINESS_RULE_VIOLATION",
        details: Any = None,
    ) -> None:
        super().__init__(
            message=message,
            code=code,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=details,
        )


class TooManyRequestsError(AppError):
    """Límite de tasa excedido."""

    def __init__(
        self,
        message: str = "Demasiadas solicitudes. Inténtalo nuevamente más tarde.",
        retry_after: int | None = None,
    ) -> None:
        details = {"retry_after_seconds": retry_after} if retry_after is not None else None
        super().__init__(
            message=message,
            code="RATE_LIMIT_EXCEEDED",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            details=details,
        )
        self.retry_after = retry_after


def _error_payload(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def register_exception_handlers(app: FastAPI) -> None:
    """Registra los manejadores centralizados de excepciones en FastAPI."""

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        headers = (
            {"Retry-After": str(exc.retry_after)}
            if isinstance(exc, TooManyRequestsError) and exc.retry_after is not None
            else None
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.code, exc.message, exc.details),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=_error_payload(
                code="VALIDATION_ERROR",
                message="Los datos enviados no cumplen con el formato requerido.",
                details=exc.errors(),
            ),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_error_payload(
                code="INTERNAL_SERVER_ERROR",
                message="Error interno inesperado del servidor.",
            ),
        )
