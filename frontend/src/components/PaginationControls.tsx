interface PaginationControlsProps {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (nextOffset: number) => void;
}

export function PaginationControls({
  total,
  limit,
  offset,
  onPageChange,
}: PaginationControlsProps) {
  if (total <= limit && offset === 0) {
    return null;
  }

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <nav className="pagination-bar" aria-label="Paginación">
      <span className="stat-label">
        Página {currentPage} de {totalPages} ({total} registros)
      </span>
      <div className="actions-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={offset <= 0}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={offset + limit >= total}
          onClick={() => onPageChange(offset + limit)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
