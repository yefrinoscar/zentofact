export interface RipleyApiClientOptions {
  baseUrl: string;
  apiKey: string;
  shopId?: number | string;
  fetchImpl?: typeof fetch;
}

export interface ListOffersOptions {
  max?: number;
  offset?: number;
  offerStateCodes?: string;
  sku?: string;
  productId?: string;
  favorite?: boolean;
}

/** A read-only, normalized representation of a Mirakl seller offer. */
export interface RipleyOffer {
  offerId: string | null;
  sellerSku: string;
  productSku: string | null;
  productTitle: string | null;
  active: boolean | null;
  quantity: number | null;
  price: number | null;
  imageUrl: string | null;
  raw: unknown;
}

export interface RipleyOfferPage {
  offers: RipleyOffer[];
  totalCount: number | null;
  offset: number;
  max: number;
}

export interface RipleyProductContent {
  productSku: string;
  productTitle: string | null;
  imageUrl: string | null;
  raw: unknown;
}

export interface ListOrdersOptions {
  max?: number;
  offset?: number;
  orderIds?: string[];
  orderStateCodes?: string[];
  startDate?: string;
  endDate?: string;
  startUpdateDate?: string;
  endUpdateDate?: string;
}

/** A read-only normalized view of a Mirakl order. The original payload is preserved. */
export interface RipleyOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  currency: string;
  total: number | null;
  raw: unknown;
}

export interface RipleyOrderPage {
  orders: RipleyOrder[];
  totalCount: number;
  offset: number;
  max: number;
}

export interface RipleySvcClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export interface RipleySvcPageOptions {
  page?: number;
  limit?: number;
  orderId?: string;
}

export interface RipleySvcLogisticsOrderOptions extends RipleySvcPageOptions {
  statusManagement?: string;
}

export interface RipleySvcLabelOptions extends RipleySvcPageOptions {
  find?: 'printed' | 'printable' | 'error';
}

export interface RipleySvcManifestLabel {
  _id: string;
  order_id: string;
  courier: string;
}

export interface RipleySvcManifestScheduleGroup {
  totalLabels: number;
  labels: RipleySvcManifestLabel[];
  pickupDate: string;
}

export interface RipleySvcManifestSchedule {
  scheduleableFromToday: RipleySvcManifestScheduleGroup;
  scheduleableFromTomorrow: RipleySvcManifestScheduleGroup;
  warehouseAddress: string;
}
