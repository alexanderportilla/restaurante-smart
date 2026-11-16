import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { catalogService } from '../services/catalogService';
import { extractApiError } from '../services/httpClient';
import { formatCurrency } from '../utils/formatters';

export function CatalogPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin', 'manager');

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | ''>('');
  const [search, setSearch] = useState('');

  const fetchCatalog = useCallback(async () => {
    const [categories, products] = await Promise.all([
      catalogService.listCategories(false),
      catalogService.listProducts({
        category_id: selectedCategoryId === '' ? undefined : selectedCategoryId,
        search: search.trim() || undefined,
        limit: 50,
      }),
    ]);
    return { categories, products };
  }, [selectedCategoryId, search]);

  const { data, isLoading, error, reload } = useAsyncResource(fetchCatalog);

  const [catName, setCatName] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catOrder, setCatOrder] = useState('1');

  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategoryId, setProdCategoryId] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodPrep, setProdPrep] = useState('15');
  const [prodDesc, setProdDesc] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!catName.trim() || !/^[a-z0-9-]+$/.test(catSlug.trim())) {
      setFeedback({
        type: 'error',
        text: 'Ingresa nombre y slug válido en minúsculas y guiones (ej. platos-fuertes).',
      });
      return;
    }

    try {
      await catalogService.createCategory({
        name: catName.trim(),
        slug: catSlug.trim(),
        display_order: Number(catOrder) || 0,
        is_active: true,
      });
      setCatName('');
      setCatSlug('');
      setFeedback({ type: 'success', text: 'Categoría creada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const categoryIdNum = Number(prodCategoryId || data?.categories[0]?.id);
    const priceNum = Number(prodPrice);

    if (!prodName.trim() || !prodSku.trim() || !categoryIdNum || Number.isNaN(priceNum) || priceNum < 0) {
      setFeedback({ type: 'error', text: 'Completa nombre, SKU, categoría y precio válido.' });
      return;
    }

    try {
      await catalogService.createProduct({
        category_id: categoryIdNum,
        name: prodName.trim(),
        sku: prodSku.trim(),
        description: prodDesc.trim() || null,
        price: priceNum,
        preparation_minutes: Number(prodPrep) || 15,
        is_available: true,
        is_active: true,
      });
      setProdName('');
      setProdSku('');
      setProdPrice('');
      setProdDesc('');
      setFeedback({ type: 'success', text: 'Producto agregado al menú.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  async function toggleProductAvailability(productId: number, current: boolean) {
    setFeedback(null);
    try {
      await catalogService.updateProduct(productId, { is_available: !current });
      setFeedback({ type: 'success', text: 'Disponibilidad de producto actualizada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  async function handleDeactivateProduct(productId: number) {
    setFeedback(null);
    try {
      await catalogService.deleteProduct(productId);
      setFeedback({ type: 'success', text: 'Producto desactivado del menú.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Catálogo de Productos y Categorías</h1>
          <p className="page-subtitle">Menú digital del restaurante y administración de oferta.</p>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {feedback && (
        <AlertBanner
          variant={feedback.type}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {canManage && (
        <div className="grid-two">
          <section className="card">
            <h2>Nueva categoría</h2>
            <form onSubmit={handleCreateCategory}>
              <div className="form-field">
                <label htmlFor="cat-name">Nombre</label>
                <input
                  id="cat-name"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="cat-slug">Slug</label>
                <input
                  id="cat-slug"
                  required
                  value={catSlug}
                  onChange={(e) => setCatSlug(e.target.value)}
                  placeholder="platos-fuertes"
                />
              </div>
              <div className="form-field">
                <label htmlFor="cat-order">Orden</label>
                <input
                  id="cat-order"
                  type="number"
                  min={0}
                  value={catOrder}
                  onChange={(e) => setCatOrder(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Crear categoría
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Nuevo producto</h2>
            <form onSubmit={handleCreateProduct}>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="prod-name">Nombre</label>
                  <input
                    id="prod-name"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="prod-sku">SKU</label>
                  <input
                    id="prod-sku"
                    required
                    value={prodSku}
                    onChange={(e) => setProdSku(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="prod-cat">Categoría</label>
                  <select
                    id="prod-cat"
                    value={prodCategoryId || data?.categories[0]?.id || ''}
                    onChange={(e) => setProdCategoryId(e.target.value)}
                  >
                    {data?.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="prod-price">Precio ($)</label>
                  <input
                    id="prod-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="prod-prep">Prep. (min)</label>
                  <input
                    id="prod-prep"
                    type="number"
                    min="0"
                    value={prodPrep}
                    onChange={(e) => setProdPrep(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="prod-desc">Descripción</label>
                <input
                  id="prod-desc"
                  value={prodDesc}
                  onChange={(e) => setProdDesc(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Crear producto
              </button>
            </form>
          </section>
        </div>
      )}

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="filter-search">Buscar producto</label>
            <input
              id="filter-search"
              placeholder="Ej. Ceviche, Lomo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="filter-cat">Filtrar por categoría</label>
            <select
              id="filter-cat"
              value={selectedCategoryId}
              onChange={(e) =>
                setSelectedCategoryId(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">Todas las categorías</option>
              {data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {isLoading ? (
        <LoadingState label="Cargando menú..." />
      ) : (
        <section className="card">
          <h2>Productos ({data?.products.total ?? 0})</h2>
          {!data || data.products.items.length === 0 ? (
            <p className="empty-state">No hay productos que coincidan con el filtro.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Precio</th>
                    <th>Disponibilidad</th>
                    {canManage && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.products.items.map((product) => (
                    <tr key={product.id}>
                      <td>{product.sku}</td>
                      <td>
                        <strong>{product.name}</strong>
                        {product.description && (
                          <div className="stat-label">{product.description}</div>
                        )}
                      </td>
                      <td>{product.category.name}</td>
                      <td>{formatCurrency(product.price)}</td>
                      <td>
                        <StatusBadge status={product.is_available ? 'active' : 'inactive'} />
                      </td>
                      {canManage && (
                        <td>
                          <div className="actions-row">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() =>
                                void toggleProductAvailability(product.id, product.is_available)
                              }
                            >
                              {product.is_available ? 'Pausar' : 'Habilitar'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => void handleDeactivateProduct(product.id)}
                            >
                              Desactivar
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
