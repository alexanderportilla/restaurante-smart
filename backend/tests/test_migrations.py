from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config


def test_alembic_offline_sql_includes_btree_gist_and_exclusion() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    output = StringIO()
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    cfg.output_buffer = output

    command.upgrade(cfg, "head", sql=True)
    ddl = output.getvalue()

    assert "CREATE EXTENSION IF NOT EXISTS btree_gist;" in ddl
    assert "CREATE TABLE roles" in ddl
    assert "CREATE TABLE reservations" in ddl
    assert "ADD CONSTRAINT uq_reservations_no_overlap" in ddl
    assert "EXCLUDE USING gist" in ddl
    assert "WHERE (status IN ('pending', 'confirmed'))" in ddl
    assert "INSERT INTO roles" in ddl
    assert "INSERT INTO order_statuses" in ddl
