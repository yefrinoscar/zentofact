export type FalabellaApiFormat = 'JSON' | 'XML';

export interface FalabellaApiCredentials {
  userId: string;
  apiKey: string;
}

export interface FalabellaApiClientOptions extends FalabellaApiCredentials {
  baseUrl?: string;
  version?: string;
  defaultFormat?: FalabellaApiFormat;
  fetchImpl?: typeof fetch;
}

export interface FalabellaApiCallOptions {
  action: string;
  path?: string;
  params?: Record<string, string | number | boolean | undefined>;
  format?: FalabellaApiFormat;
  accept?: 'application/json' | 'application/xml';
  allowXmlResponse?: boolean;
  signal?: AbortSignal;
}

export interface FalabellaApiResponse<T = unknown> {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  data: T;
  rawText: string;
}

export interface FalabellaErrorResponseHead {
  RequestAction?: string;
  ErrorType?: string;
  ErrorCode?: string | number;
  ErrorMessage?: string;
}

export interface FalabellaErrorResponseBody {
  ErrorDetail?: unknown;
  [key: string]: unknown;
}

export interface FalabellaErrorDocument {
  ErrorResponse?: {
    Head?: FalabellaErrorResponseHead;
    Body?: FalabellaErrorResponseBody | string;
  };
  [key: string]: unknown;
}

export interface GetOrdersV2Filters {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  limit?: number;
  offset?: number;
  status?: 'pending' | 'canceled' | 'ready_to_ship' | 'delivered' | 'returned' | 'shipped' | 'failed';
  sortDirection?: 'ASC' | 'DESC';
  shippingType?: 'dropshipping' | 'own_warehouse';
}

export interface GetDocumentOptions {
  orderItemIds: Array<string | number>;
  documentType?: 'shippingParcel';
}

export interface SetStatusToReadyToShipOptions {
  orderItemIds: Array<string | number>;
  packageId: string;
}

export interface FalabellaDocument {
  DocumentType?: string;
  MimeType?: string;
  File?: string;
  [key: string]: unknown;
}

export interface FalabellaOrderRecord {
  OrderId?: string | number;
  OrderNumber?: string | number;
  CustomerFirstName?: string;
  CustomerLastName?: string;
  PaymentMethod?: string;
  Remarks?: string;
  DeliveryInfo?: string;
  Price?: string | number;
  GrandTotal?: string | number;
  GiftOption?: string | number | boolean;
  GiftMessage?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  NationalRegistrationNumber?: string;
  ItemsCount?: string | number;
  Statuses?: unknown;
  ExtraAttributes?: unknown;
  [key: string]: unknown;
}

export interface NormalizedGetOrdersResult {
  totalCount: number | null;
  orders: FalabellaOrderRecord[];
}
