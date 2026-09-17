export interface MercadoLibreApiClientOptions {
  accessToken: string;
  baseUrl?: string;
  siteId?: string;
  fetchImpl?: typeof fetch;
}

export interface MercadoLibreToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
  scope: string | null;
  tokenType: string;
  raw: unknown;
}

export interface AuthorizationUrlOptions {
  appId: string;
  redirectUri: string;
  authHost?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

export interface ExchangeCodeOptions {
  appId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  fetchImpl?: typeof fetch;
  tokenUrl?: string;
}

export interface RefreshTokenOptions {
  appId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  tokenUrl?: string;
}

export interface SearchOrdersOptions {
  sellerId: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  offset?: number;
  limit?: number;
  sort?: 'date_asc' | 'date_desc';
}

export interface SearchItemsOptions {
  sellerId: string;
  status?: string;
  offset?: number;
  limit?: number;
  searchType?: 'scan';
  scrollId?: string;
  userProductId?: string;
}

export interface MercadoLibreOrder {
  orderId: string;
  packId: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  currency: string;
  total: number | null;
  paidAmount: number | null;
  shippingId: string | null;
  raw: unknown;
}

export interface MercadoLibreOrderPage {
  orders: MercadoLibreOrder[];
  total: number;
  offset: number;
  limit: number;
}

export interface MercadoLibreItem {
  itemId: string;
  sellerSku: string | null;
  title: string | null;
  status: string | null;
  availableQuantity: number | null;
  price: number | null;
  permalink: string | null;
  userProductId: string | null;
  catalogProductId: string | null;
  variationId: string | null;
  pictureUrl: string | null;
  raw: unknown;
}

export interface MercadoLibreItemPage {
  itemIds: string[];
  items: MercadoLibreItem[];
  total: number;
  offset: number;
  limit: number;
  scrollId: string | null;
}

export interface MercadoLibreShipment {
  shipmentId: string;
  status: string | null;
  substatus: string | null;
  mode: string | null;
  logisticType: string | null;
  trackingNumber: string | null;
  raw: unknown;
}

export interface MercadoLibreBillingInfo {
  siteId: string | null;
  name: string | null;
  lastName: string | null;
  documentType: string | null;
  documentNumber: string | null;
  customerType: string | null;
  raw: unknown;
}

export interface MercadoLibreUser {
  userId: string;
  nickname: string | null;
  siteId: string | null;
  raw: unknown;
}
