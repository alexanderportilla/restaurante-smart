export type RoleCode = 'admin' | 'manager' | 'staff' | 'customer';

export type ReservationStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  detail?: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthStatus {
  status: string;
  service: string;
  database: string;
}

export interface CurrentUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  role_code: RoleCode;
  role_name: string;
  permissions: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: CurrentUser;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface Permission {
  id: number;
  code: string;
  description: string | null;
}

export interface Role {
  id: number;
  code: RoleCode | string;
  name: string;
  description: string | null;
  permissions: Permission[];
}

export interface UserRecord {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface UserCreatePayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
  role_code: string;
  is_active: boolean;
}

export interface UserUpdatePayload {
  full_name?: string;
  phone?: string;
  role_code?: string;
  is_active?: boolean;
  password?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryPayload {
  name: string;
  slug: string;
  description?: string | null;
  display_order: number;
  is_active: boolean;
}

export interface Product {
  id: number;
  category_id: number;
  name: string;
  sku: string;
  description: string | null;
  price: string;
  preparation_minutes: number;
  is_available: boolean;
  is_active: boolean;
  category: Category;
  created_at: string;
  updated_at: string;
}

export interface ProductPayload {
  category_id: number;
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  preparation_minutes: number;
  is_available: boolean;
  is_active: boolean;
}

export interface RestaurantTable {
  id: number;
  code: string;
  name: string;
  capacity: number;
  location: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TablePayload {
  code: string;
  name: string;
  capacity: number;
  location: string;
  is_active: boolean;
}

export interface AvailabilityResponse {
  start_time: string;
  end_time: string;
  party_size: number;
  available_tables: RestaurantTable[];
}

export interface Reservation {
  id: string;
  user_id: string | null;
  table_id: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  party_size: number;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  confirmation_code: string;
  notes: string | null;
  table: RestaurantTable;
  created_at: string;
  updated_at: string;
}

export interface ReservationCreatePayload {
  table_id: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  party_size: number;
  start_time: string;
  end_time: string;
  notes?: string;
}

export interface OrderStatus {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_terminal: boolean;
}

export interface OrderItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: string;
  line_total: string;
  special_instructions: string | null;
  product_name: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string | null;
  table_id: number | null;
  reservation_id: string | null;
  order_type: OrderType;
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  notes: string | null;
  confirmed_at: string | null;
  status: OrderStatus;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
}

export interface OrderCreatePayload {
  order_type: OrderType;
  table_id?: number | null;
  reservation_id?: string | null;
  notes?: string;
  items: Array<{
    product_id: number;
    quantity: number;
    special_instructions?: string;
  }>;
}

export interface NotificationRecord {
  id: string;
  user_id: string | null;
  channel: string;
  event_type: string;
  title: string;
  message: string;
  reference_type: string;
  reference_id: string;
  status: string;
  is_read: boolean;
  sent_at: string | null;
  created_at: string;
}

export interface StatusCountItem {
  status_code: string;
  status_name: string;
  count: number;
}

export interface ReportSummary {
  from_date: string | null;
  to_date: string | null;
  total_orders: number;
  total_revenue: string;
  total_reservations: number;
  active_tables: number;
  orders_by_status: StatusCountItem[];
}

export interface TopProductItem {
  product_id: number;
  product_name: string;
  sku: string;
  total_quantity: number;
  total_revenue: string;
}

export interface TopProductsReport {
  from_date: string | null;
  to_date: string | null;
  items: TopProductItem[];
}
