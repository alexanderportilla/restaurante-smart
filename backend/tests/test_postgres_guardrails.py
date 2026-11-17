from typing import Any

import pytest

from tests import conftest as test_conftest
from tests import test_full_flows_postgres, test_postgres_integration
from tests.conftest import (
    apply_isolated_postgres_test_env,
    assert_isolated_postgres_test_env,
    require_isolated_test_database_url,
    validate_isolated_test_database_url,
)

FAKE_SECRET = "DummySecretNotForProd987654321"
VALID_URL_IP = f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test"
VALID_URL_LOCALHOST = (
    f"postgresql://restaurante_test_user:{FAKE_SECRET}@localhost:5433/restaurante_smart_test"
)


@pytest.mark.parametrize(
    "valid_url",
    [
        VALID_URL_IP,
        VALID_URL_LOCALHOST,
        f"  {VALID_URL_IP}  ",
    ],
)
def test_validate_accepts_strictly_allowlisted_isolated_urls(valid_url: str) -> None:
    validated = validate_isolated_test_database_url(valid_url)
    assert validated == valid_url.strip()
    assert require_isolated_test_database_url("1", valid_url) == valid_url.strip()


@pytest.mark.parametrize(
    ("invalid_url", "expected_fragment"),
    [
        # Puertos distintos de 5433
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5432/restaurante_smart_test",
            "5433",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@localhost:5434/restaurante_smart_test",
            "5433",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1/restaurante_smart_test",
            "5433",
        ),
        # Hosts no permitidos
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@postgres-app:5433/restaurante_smart_test",
            "Host",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@postgres-sonar:5433/restaurante_smart_test",
            "Host",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@10.0.0.25:5433/restaurante_smart_test",
            "Host",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@db.example.com:5433/restaurante_smart_test",
            "Host",
        ),
        # Bases de datos distintas de restaurante_smart_test
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/postgres",
            "restaurante_smart_test",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/sonarqube",
            "restaurante_smart_test",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart",
            "restaurante_smart_test",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test_2",
            "restaurante_smart_test",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_testing",
            "restaurante_smart_test",
        ),
        (
            f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/test_db",
            "restaurante_smart_test",
        ),
        # Usuario no permitido o contraseña ausente / vacía
        (
            f"postgresql+psycopg://restaurante_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test",
            "restaurante_test_user",
        ),
        (
            f"postgresql+psycopg://postgres:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test",
            "restaurante_test_user",
        ),
        (
            "postgresql+psycopg://restaurante_test_user@127.0.0.1:5433/restaurante_smart_test",
            "contraseña",
        ),
        (
            "postgresql+psycopg://restaurante_test_user:@127.0.0.1:5433/restaurante_smart_test",
            "contraseña",
        ),
        # URLs malformadas o con espacios/fragmentos
        ("", "obligatoria"),
        ("   ", "obligatoria"),
        ("not-a-valid-database-url", "inválido"),
        (f"{VALID_URL_IP} extra", "espacio"),
        (f"{VALID_URL_IP}#frag", "fragmentos"),
        # Esquemas/drivers no soportados
        ("sqlite:///./restaurante_smart_test.db", "Esquema/driver"),
        (
            f"mysql+pymysql://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test",
            "Esquema/driver",
        ),
        (
            f"postgresql+psycopg2://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test",
            "Esquema/driver",
        ),
        (
            f"postgresql+asyncpg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5433/restaurante_smart_test",
            "Esquema/driver",
        ),
        # Parámetros de consulta peligrosos o arbitrarios
        (
            f"{VALID_URL_IP}?host=postgres-app",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?HOST=postgres-app",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?hostaddr=172.18.0.5",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?port=5432",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?service=prod",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?passfile=/tmp/pgpass",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?options=-csearch_path=public",
            "prohibidos",
        ),
        (
            f"{VALID_URL_IP}?application_name=override",
            "parámetros de consulta",
        ),
    ],
)
def test_validate_rejects_disallowed_urls_without_leaking_secrets(
    invalid_url: str,
    expected_fragment: str,
) -> None:
    with pytest.raises(ValueError) as exc_info:
        validate_isolated_test_database_url(invalid_url)

    message = str(exc_info.value)
    assert expected_fragment in message
    assert FAKE_SECRET not in message
    if invalid_url.strip():
        assert invalid_url.strip() not in message


@pytest.mark.parametrize("bad_flag", [None, "", "0", "true", "yes", " 1"])
def test_require_rejects_missing_or_invalid_run_flag(bad_flag: str | None) -> None:
    with pytest.raises(ValueError, match="RUN_POSTGRES_TESTS"):
        require_isolated_test_database_url(bad_flag, VALID_URL_IP)


def test_require_rejects_missing_test_database_url() -> None:
    with pytest.raises(ValueError, match="TEST_DATABASE_URL"):
        require_isolated_test_database_url("1", None)


@pytest.mark.parametrize(
    "bad_url",
    [
        f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@postgres-app:5432/restaurante_smart",
        f"postgresql+psycopg://restaurante_test_user:{FAKE_SECRET}@127.0.0.1:5432/restaurante_smart_test",
        f"{VALID_URL_IP}?host=postgres-app",
        "",
    ],
)
def test_guardrails_abort_before_database_url_mutation_or_engine_creation(
    monkeypatch: pytest.MonkeyPatch,
    bad_url: str,
) -> None:
    engine_calls: list[Any] = []
    session_factory_calls: list[Any] = []

    def fail_if_called_engine() -> Any:
        engine_calls.append("called")
        raise AssertionError("get_engine no debe invocarse cuando la guarda rechaza la URL.")

    def fail_if_called_session_factory() -> Any:
        session_factory_calls.append("called")
        raise AssertionError(
            "get_session_factory no debe invocarse cuando la guarda rechaza la URL."
        )

    monkeypatch.setattr(test_conftest, "get_engine", fail_if_called_engine)
    monkeypatch.setattr(test_postgres_integration, "get_engine", fail_if_called_engine)
    monkeypatch.setattr(
        test_postgres_integration, "get_session_factory", fail_if_called_session_factory
    )
    monkeypatch.setattr(test_full_flows_postgres, "get_engine", fail_if_called_engine)
    monkeypatch.setattr(
        test_full_flows_postgres, "get_session_factory", fail_if_called_session_factory
    )

    sentinel_db_url = "postgresql+psycopg://untouched:untouched@localhost:5432/untouched"
    monkeypatch.setenv("DATABASE_URL", sentinel_db_url)
    monkeypatch.setenv("RUN_POSTGRES_TESTS", "1")
    monkeypatch.setenv("TEST_DATABASE_URL", bad_url)

    with pytest.raises(pytest.fail.Exception) as exc_fixture:
        apply_isolated_postgres_test_env(monkeypatch)
    assert FAKE_SECRET not in str(exc_fixture.value)
    assert test_conftest.os.environ["DATABASE_URL"] == sentinel_db_url

    with pytest.raises(pytest.fail.Exception) as exc_integ:
        test_postgres_integration.test_postgres_schema_btree_gist_and_seed_catalogs()
    assert FAKE_SECRET not in str(exc_integ.value)

    with pytest.raises(pytest.fail.Exception) as exc_crud:
        test_postgres_integration.test_postgres_crud_exclusion_constraint_transactions_and_e2e_api()
    assert FAKE_SECRET not in str(exc_crud.value)

    with pytest.raises(pytest.fail.Exception) as exc_full:
        test_full_flows_postgres.test_full_http_flows_against_real_postgresql()
    assert FAKE_SECRET not in str(exc_full.value)

    assert engine_calls == []
    assert session_factory_calls == []


def test_apply_and_assert_accept_valid_url_without_opening_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUN_POSTGRES_TESTS", "1")
    monkeypatch.setenv("TEST_DATABASE_URL", VALID_URL_IP)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    applied = apply_isolated_postgres_test_env(monkeypatch)
    assert applied == VALID_URL_IP
    assert assert_isolated_postgres_test_env() == VALID_URL_IP
    assert test_conftest.os.environ["DATABASE_URL"] == VALID_URL_IP


def test_assert_rejects_mismatched_database_url_even_when_test_url_is_valid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RUN_POSTGRES_TESTS", "1")
    monkeypatch.setenv("TEST_DATABASE_URL", VALID_URL_IP)
    monkeypatch.setenv(
        "DATABASE_URL",
        f"postgresql+psycopg://restaurante_user:{FAKE_SECRET}@postgres-app:5432/restaurante_smart",
    )

    with pytest.raises(pytest.fail.Exception, match="no coincide"):
        assert_isolated_postgres_test_env()
