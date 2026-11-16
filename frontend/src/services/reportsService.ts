import { httpClient } from './httpClient';
import type { ReportSummary, TopProductsReport } from '../types/api';

export interface ReportDateRange {
  from_date?: string;
  to_date?: string;
}

export const reportsService = {
  async getSummary(range: ReportDateRange = {}): Promise<ReportSummary> {
    const { data } = await httpClient.get<ReportSummary>('/reports/summary', { params: range });
    return data;
  },

  async getTopProducts(range: ReportDateRange = {}, limit = 10): Promise<TopProductsReport> {
    const { data } = await httpClient.get<TopProductsReport>('/reports/top-products', {
      params: { ...range, limit },
    });
    return data;
  },
};
