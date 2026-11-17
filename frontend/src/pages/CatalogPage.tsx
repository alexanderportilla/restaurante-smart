import { useCallback, useState, type FormEvent } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { LoadingState } from '../components/LoadingState';
import { Modal } from '../components/Modal';
import { PaginationControls } from '../components/PaginationControls';
import { StatusBadge } from '../components/StatusBadge';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { useAuth } from '../hooks/useAuth';
import { catalogService } from '../services/catalogService';
import { extractApiError } from '../services/httpClient';
import type { Category, Product } from '../types/api';
import { formatCurrency } from '../utils/formatters';

const PAGE_LIMIT = 20;

export function CatalogPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin', 'manager');

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState<boolean | undefined>(undefined);
  const [showInactive, setShowInactive] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchCatalog = useCallback(async () => {
    const [categories, products] = await Promise.all([
      catalogService.listCategories(false),
      catalogService.listProducts({
        category_id: selectedCategoryId === '' ? undefined : selectedCategoryId,
        only_available: onlyAvailable,
        only_active: canManage ? !showInactive : true,
        search: search.trim() || undefined,
        limit: PAGE_LIMIT,
        offset,
      }),
    ]);
    return { categories, products };
  }, [selectedCategoryId, onlyAvailable, canManage, showInactive, search, offset]);

  const { data, isLoading, error, reload } = useAsyncResource(fetchCatalog);

  const [catName, setCatName] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catOrder, setCatOrder] = useState('1');
  const [catDesc, setCatDesc] = useState('');
  const [submittingCat, setSubmittingCat] = useState(false);

  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategoryId, setProdCategoryId] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodPrep, setProdPrep] = useState('15');
  const [prodDesc, setProdDesc] = useState('');
  const [submittingProd, setSubmittingProd] = useState(false);

  const [busyProductId, setBusyProductId] = useState<number | null>(null);
  const [busyCategoryId, setBusyCategoryId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatSlug, setEditCatSlug] = useState('');
  const [editCatOrder, setEditCatOrder] = useState('0');
  const [editCatDesc, setEditCatDesc] = useState('');
  const [editCatActive, setEditCatActive] = useState(true);
  const [savingCatEdit, setSavingCatEdit] = useState(false);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProdName, setEditProdName] = useState('');
  const [editProdSku, setEditProdSku] = useState('');
  const [editProdCatId, setEditProdCatId] = useState('');
  const [editProdPrice, setEditProdPrice] = useState('');
  const [editProdPrep, setEditProdPrep] = useState('15');
  const [editProdDesc, setEditProdDesc] = useState('');
  const [editProdAvail, setEditProdAvail] = useState(true);
  const [editProdActive, setEditProdActive] = useState(true);
  const [savingProdEdit, setSavingProdEdit] = useState(false);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (catName.trim().length < 2 || !/^[a-z0-9-]+$/.test(catSlug.trim())) {
      setFeedback({
        type: 'error',
        text: 'Ingresa nombre (mín. 2) y slug válido en minúsculas y guiones (ej. platos-fuertes).',
      });
      return;
    }

    setSubmittingCat(true);
    try {
      await catalogService.createCategory({
        name: catName.trim(),
        slug: catSlug.trim(),
        description: catDesc.trim() || null,
        display_order: Math.max(0, Number(catOrder) || 0),
        is_active: true,
      });
      setCatName('');
      setCatSlug('');
      setCatDesc('');
      setFeedback({ type: 'success', text: 'Categoría creada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSubmittingCat(false);
    }
  }

  function openCategoryEdit(category: Category) {
    setEditingCategory(category);
    setEditCatName(category.name);
    setEditCatSlug(category.slug);
    setEditCatOrder(String(category.display_order));
    setEditCatDesc(category.description ?? '');
    setEditCatActive(category.is_active);
  }

  async function handleSaveCategoryEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCategory) {
      return;
    }
    setFeedback(null);
    if (editCatName.trim().length < 2 || !/^[a-z0-9-]+$/.test(editCatSlug.trim())) {
      setFeedback({
        type: 'error',
        text: 'Verifica nombre (mín. 2) y slug válido (minúsculas y guiones).',
      });
      return;
    }

    setSavingCatEdit(true);
    try {
      await catalogService.updateCategory(editingCategory.id, {
        name: editCatName.trim(),
        slug: editCatSlug.trim(),
        description: editCatDesc.trim() || null,
        display_order: Math.max(0, Number(editCatOrder) || 0),
        is_active: editCatActive,
      });
      setEditingCategory(null);
      setFeedback({ type: 'success', text: 'Categoría actualizada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSavingCatEdit(false);
    }
  }

  async function handleDeactivateCategory(categoryId: number) {
    setFeedback(null);
    setBusyCategoryId(categoryId);
    try {
      await catalogService.deleteCategory(categoryId);
      setFeedback({ type: 'success', text: 'Categoría desactivada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyCategoryId(null);
    }
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const categoryIdNum = Number(prodCategoryId || data?.categories[0]?.id);
    const priceNum = Number(prodPrice);
    const prepNum = Number(prodPrep);

    if (
      prodName.trim().length < 2 ||
      prodSku.trim().length < 2 ||
      !categoryIdNum ||
      Number.isNaN(priceNum) ||
      priceNum < 0 ||
      Number.isNaN(prepNum) ||
      prepNum < 0 ||
      prepNum > 300
    ) {
      setFeedback({
        type: 'error',
        text: 'Completa nombre, SKU (mín. 2), categoría, precio (>= 0) y preparación (0-300 min).',
      });
      return;
    }

    setSubmittingProd(true);
    try {
      await catalogService.createProduct({
        category_id: categoryIdNum,
        name: prodName.trim(),
        sku: prodSku.trim(),
        description: prodDesc.trim() || null,
        price: priceNum,
        preparation_minutes: prepNum,
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
    } finally {
      setSubmittingProd(false);
    }
  }

  function openProductEdit(product: Product) {
    setEditingProduct(product);
    setEditProdName(product.name);
    setEditProdSku(product.sku);
    setEditProdCatId(String(product.category_id));
    setEditProdPrice(product.price);
    setEditProdPrep(String(product.preparation_minutes));
    setEditProdDesc(product.description ?? '');
    setEditProdAvail(product.is_available);
    setEditProdActive(product.is_active);
  }

  async function handleSaveProductEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) {
      return;
    }
    setFeedback(null);
    const categoryIdNum = Number(editProdCatId);
    const priceNum = Number(editProdPrice);
    const prepNum = Number(editProdPrep);

    if (
      editProdName.trim().length < 2 ||
      editProdSku.trim().length < 2 ||
      !categoryIdNum ||
      Number.isNaN(priceNum) ||
      priceNum < 0 ||
      Number.isNaN(prepNum) ||
      prepNum < 0 ||
      prepNum > 300
    ) {
      setFeedback({
        type: 'error',
        text: 'Verifica nombre, SKU, categoría, precio y tiempo de preparación.',
      });
      return;
    }

    setSavingProdEdit(true);
    try {
      await catalogService.updateProduct(editingProduct.id, {
        category_id: categoryIdNum,
        name: editProdName.trim(),
        sku: editProdSku.trim(),
        description: editProdDesc.trim() || null,
        price: priceNum,
        preparation_minutes: prepNum,
        is_available: editProdAvail,
        is_active: editProdActive,
      });
      setEditingProduct(null);
      setFeedback({ type: 'success', text: 'Producto actualizado.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setSavingProdEdit(false);
    }
  }

  async function toggleProductAvailability(productId: number, current: boolean) {
    setFeedback(null);
    setBusyProductId(productId);
    try {
      await catalogService.updateProduct(productId, { is_available: !current });
      setFeedback({ type: 'success', text: 'Disponibilidad de producto actualizada.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyProductId(null);
    }
  }

  async function handleDeactivateProduct(productId: number) {
    setFeedback(null);
    setBusyProductId(productId);
    try {
      await catalogService.deleteProduct(productId);
      setFeedback({ type: 'success', text: 'Producto desactivado del menú.' });
      await reload();
    } catch (err) {
      setFeedback({ type: 'error', text: extractApiError(err).message });
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Catálogo de Productos y Categorías</h1>
          <p className="page-subtitle">Menú digital del restaurante y administración de oferta.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
          Actualizar catálogo
        </button>
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
            <form onSubmit={handleCreateCategory} noValidate>
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
              <div className="form-grid">
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
                <div className="form-field">
                  <label htmlFor="cat-desc">Descripción</label>
                  <input
                    id="cat-desc"
                    value={catDesc}
                    onChange={(e) => setCatDesc(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={submittingCat}>
                {submittingCat ? 'Guardando...' : 'Crear categoría'}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Nuevo producto</h2>
            <form onSubmit={handleCreateProduct} noValidate>
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
                    max="300"
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
              <button type="submit" className="btn btn-primary" disabled={submittingProd}>
                {submittingProd ? 'Guardando...' : 'Crear producto'}
              </button>
            </form>
          </section>
        </div>
      )}

      {canManage && data && data.categories.length > 0 && (
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>Categorías registradas ({data.categories.length})</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Slug</th>
                  <th>Orden</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.name}</strong>
                      {category.description && (
                        <div className="stat-label">{category.description}</div>
                      )}
                    </td>
                    <td>{category.slug}</td>
                    <td>{category.display_order}</td>
                    <td>
                      <StatusBadge status={category.is_active ? 'active' : 'inactive'} />
                    </td>
                    <td>
                      <div className="actions-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyCategoryId === category.id}
                          onClick={() => openCategoryEdit(category)}
                        >
                          Editar categoría
                        </button>
                        {category.is_active && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busyCategoryId === category.id}
                            onClick={() => void handleDeactivateCategory(category.id)}
                          >
                            Desactivar categoría
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="filter-search">Buscar producto</label>
            <input
              id="filter-search"
              placeholder="Ej. Ceviche, Lomo..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="filter-cat">Filtrar por categoría</label>
            <select
              id="filter-cat"
              value={selectedCategoryId}
              onChange={(e) => {
                setSelectedCategoryId(e.target.value === '' ? '' : Number(e.target.value));
                setOffset(0);
              }}
            >
              <option value="">Todas las categorías</option>
              {data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="filter-avail">Disponibilidad</label>
            <select
              id="filter-avail"
              value={onlyAvailable === undefined ? '' : String(onlyAvailable)}
              onChange={(e) => {
                const v = e.target.value;
                setOnlyAvailable(v === '' ? undefined : v === 'true');
                setOffset(0);
              }}
            >
              <option value="">Todos</option>
              <option value="true">Solo disponibles</option>
              <option value="false">No disponibles</option>
            </select>
          </div>
        </div>
        {canManage && (
          <label className="form-checkbox" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => {
                setShowInactive(e.target.checked);
                setOffset(0);
              }}
            />
            <span>Incluir productos desactivados</span>
          </label>
        )}
      </section>

      {isLoading ? (
        <LoadingState label="Cargando menú..." />
      ) : (
        <section className="card">
          <h2>Productos ({data?.products.total ?? 0})</h2>
          {!data || data.products.items.length === 0 ? (
            <p className="empty-state">No hay productos que coincidan con el filtro.</p>
          ) : (
            <>
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
                          <div className="stat-label">
                            Prep: {product.preparation_minutes} min
                            {!product.is_active ? ' · Desactivado' : ''}
                          </div>
                        </td>
                        <td>{product.category.name}</td>
                        <td>{formatCurrency(product.price)}</td>
                        <td>
                          <span
                            className={`badge ${
                              product.is_available ? 'badge-success' : 'badge-danger'
                            }`}
                          >
                            {product.is_available ? 'Disponible' : 'No disponible'}
                          </span>
                        </td>
                        {canManage && (
                          <td>
                            <div className="actions-row">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyProductId === product.id}
                                onClick={() => openProductEdit(product)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busyProductId === product.id}
                                onClick={() =>
                                  void toggleProductAvailability(product.id, product.is_available)
                                }
                              >
                                {product.is_available ? 'Pausar' : 'Habilitar'}
                              </button>
                              {product.is_active && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={busyProductId === product.id}
                                  onClick={() => void handleDeactivateProduct(product.id)}
                                >
                                  Desactivar
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                total={data.products.total}
                limit={PAGE_LIMIT}
                offset={offset}
                onPageChange={setOffset}
              />
            </>
          )}
        </section>
      )}

      {editingCategory && (
        <Modal
          title={`Editar categoría: ${editingCategory.name}`}
          onClose={() => setEditingCategory(null)}
        >
          <form onSubmit={handleSaveCategoryEdit} noValidate>
            <div className="form-field">
              <label htmlFor="edit-cat-name">Nombre</label>
              <input
                id="edit-cat-name"
                required
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="edit-cat-slug">Slug</label>
              <input
                id="edit-cat-slug"
                required
                value={editCatSlug}
                onChange={(e) => setEditCatSlug(e.target.value)}
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="edit-cat-order">Orden</label>
                <input
                  id="edit-cat-order"
                  type="number"
                  min={0}
                  value={editCatOrder}
                  onChange={(e) => setEditCatOrder(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-cat-desc">Descripción</label>
                <input
                  id="edit-cat-desc"
                  value={editCatDesc}
                  onChange={(e) => setEditCatDesc(e.target.value)}
                />
              </div>
            </div>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={editCatActive}
                onChange={(e) => setEditCatActive(e.target.checked)}
              />
              <span>Categoría activa</span>
            </label>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={savingCatEdit}>
                {savingCatEdit ? 'Guardando...' : 'Guardar categoría'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingCategory(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingProduct && (
        <Modal
          title={`Editar producto: ${editingProduct.name}`}
          onClose={() => setEditingProduct(null)}
        >
          <form onSubmit={handleSaveProductEdit} noValidate>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="edit-prod-name">Nombre</label>
                <input
                  id="edit-prod-name"
                  required
                  value={editProdName}
                  onChange={(e) => setEditProdName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-prod-sku">SKU</label>
                <input
                  id="edit-prod-sku"
                  required
                  value={editProdSku}
                  onChange={(e) => setEditProdSku(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-prod-cat">Categoría</label>
                <select
                  id="edit-prod-cat"
                  value={editProdCatId}
                  onChange={(e) => setEditProdCatId(e.target.value)}
                >
                  {data?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="edit-prod-price">Precio ($)</label>
                <input
                  id="edit-prod-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={editProdPrice}
                  onChange={(e) => setEditProdPrice(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="edit-prod-prep">Prep. (min)</label>
                <input
                  id="edit-prod-prep"
                  type="number"
                  min="0"
                  max="300"
                  value={editProdPrep}
                  onChange={(e) => setEditProdPrep(e.target.value)}
                />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="edit-prod-desc">Descripción</label>
              <input
                id="edit-prod-desc"
                value={editProdDesc}
                onChange={(e) => setEditProdDesc(e.target.value)}
              />
            </div>
            <div className="actions-row" style={{ marginBottom: '1rem' }}>
              <label className="form-checkbox" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={editProdAvail}
                  onChange={(e) => setEditProdAvail(e.target.checked)}
                />
                <span>Disponible para pedidos</span>
              </label>
              <label className="form-checkbox" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={editProdActive}
                  onChange={(e) => setEditProdActive(e.target.checked)}
                />
                <span>Producto activo en menú</span>
              </label>
            </div>
            <div className="actions-row">
              <button type="submit" className="btn btn-primary" disabled={savingProdEdit}>
                {savingProdEdit ? 'Guardando...' : 'Guardar producto'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingProduct(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
