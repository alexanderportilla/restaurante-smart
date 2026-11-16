import { httpClient } from './httpClient';
import type {
  Category,
  CategoryPayload,
  PaginatedResponse,
  Product,
  ProductPayload,
} from '../types/api';

export interface ProductQueryParams {
  category_id?: number;
  only_available?: boolean;
  only_active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export const catalogService = {
  async listCategories(onlyActive = false): Promise<Category[]> {
    const { data } = await httpClient.get<Category[]>('/categories', {
      params: { only_active: onlyActive },
    });
    return data;
  },

  async createCategory(payload: CategoryPayload): Promise<Category> {
    const { data } = await httpClient.post<Category>('/categories', payload);
    return data;
  },

  async updateCategory(categoryId: number, payload: Partial<CategoryPayload>): Promise<Category> {
    const { data } = await httpClient.patch<Category>(`/categories/${categoryId}`, payload);
    return data;
  },

  async deleteCategory(categoryId: number): Promise<void> {
    await httpClient.delete(`/categories/${categoryId}`);
  },

  async listProducts(params: ProductQueryParams = {}): Promise<PaginatedResponse<Product>> {
    const { data } = await httpClient.get<PaginatedResponse<Product>>('/products', { params });
    return data;
  },

  async getProduct(productId: number): Promise<Product> {
    const { data } = await httpClient.get<Product>(`/products/${productId}`);
    return data;
  },

  async createProduct(payload: ProductPayload): Promise<Product> {
    const { data } = await httpClient.post<Product>('/products', payload);
    return data;
  },

  async updateProduct(productId: number, payload: Partial<ProductPayload>): Promise<Product> {
    const { data } = await httpClient.patch<Product>(`/products/${productId}`, payload);
    return data;
  },

  async deleteProduct(productId: number): Promise<void> {
    await httpClient.delete(`/products/${productId}`);
  },
};
