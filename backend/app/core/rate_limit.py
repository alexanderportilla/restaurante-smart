import time
from collections import deque
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network
from threading import Lock

from fastapi import Request

from app.core.config import Settings, get_settings
from app.core.exceptions import TooManyRequestsError

IPNetwork = IPv4Network | IPv6Network
IPAddress = IPv4Address | IPv6Address


def _parse_trusted_proxies(raw: str) -> list[IPNetwork]:
    networks: list[IPNetwork] = []
    for item in raw.split(","):
        candidate = item.strip()
        if not candidate:
            continue
        try:
            networks.append(ip_network(candidate, strict=False))
        except ValueError:
            continue
    return networks


def _is_trusted_ip(addr: IPAddress, trusted_networks: list[IPNetwork]) -> bool:
    return any(addr in net for net in trusted_networks)


def extract_client_ip(request: Request, settings: Settings | None = None) -> str:
    """Obtiene la IP cliente validando proxies de confianza contra spoofing de X-Forwarded-For."""
    active_settings = settings or get_settings()
    direct_host = request.client.host if request.client and request.client.host else "unknown"

    try:
        direct_addr = ip_address(direct_host)
    except ValueError:
        return direct_host

    trusted_networks = _parse_trusted_proxies(active_settings.TRUSTED_PROXY_IPS)
    if not _is_trusted_ip(direct_addr, trusted_networks):
        return str(direct_addr)

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if not forwarded_for.strip():
        return str(direct_addr)

    chain: list[IPAddress] = []
    for raw_hop in forwarded_for.split(","):
        hop = raw_hop.strip()
        if not hop:
            continue
        try:
            chain.append(ip_address(hop))
        except ValueError:
            return str(direct_addr)

    for hop_addr in reversed(chain):
        if not _is_trusted_ip(hop_addr, trusted_networks):
            return str(hop_addr)

    return str(chain[0]) if chain else str(direct_addr)


class InMemoryRateLimiter:
    """Limitador por ventana deslizante en memoria por proceso (sin coordinación multi-worker)."""

    def __init__(self) -> None:
        self._buckets: dict[tuple[str, str], deque[float]] = {}
        self._lock = Lock()

    def check(self, *, scope: str, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        bucket_key = (scope, key)

        with self._lock:
            bucket = self._buckets.setdefault(bucket_key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= limit:
                retry_after = max(1, int(window_seconds - (now - bucket[0])) + 1)
                raise TooManyRequestsError(
                    message=(
                        "Demasiadas solicitudes de autenticación. "
                        f"Inténtalo nuevamente en {retry_after} segundos."
                    ),
                    retry_after=retry_after,
                )

            bucket.append(now)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


auth_rate_limiter = InMemoryRateLimiter()


def enforce_login_rate_limit(request: Request) -> None:
    settings = get_settings()
    client_ip = extract_client_ip(request, settings)
    auth_rate_limiter.check(
        scope="auth_login",
        key=client_ip,
        limit=settings.AUTH_LOGIN_RATE_LIMIT,
        window_seconds=settings.AUTH_LOGIN_RATE_WINDOW_SECONDS,
    )


def enforce_register_rate_limit(request: Request) -> None:
    settings = get_settings()
    client_ip = extract_client_ip(request, settings)
    auth_rate_limiter.check(
        scope="auth_register",
        key=client_ip,
        limit=settings.AUTH_REGISTER_RATE_LIMIT,
        window_seconds=settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )
