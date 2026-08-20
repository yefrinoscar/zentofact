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
  raw: unknown;
}

export interface RipleyOfferPage {
  offers: RipleyOffer[];
  totalCount: number | null;
  offset: number;
  max: number;
}
