import { writeFileSync } from 'fs';
import { join } from 'path';
import type { VentaItem } from '@zentofact/core';
import type { ScraperConfig, SiteProfile, FalabellaExtract, RawFalabellaOrder, ScrapeError } from './types';
import { ensureDir } from './utils';
import { createBrowser, ensureAuthenticated, saveAuthState } from './browser';
import { extractOrders, getProfile } from './falabella';
import { mapOrders } from './mapper';

export type { ScraperConfig, SiteProfile, FalabellaExtract, RawFalabellaOrder, ScrapeError } from './types';
export type { WorkflowState, StepPreview, StepResult, StepCallback } from './workflow';
export { FalabellaWorkflow } from './workflow';
export { DEFAULT_FALABELLA_PROFILE } from './falabella';
export { mapOrders, mapOrder, inferDocType } from './mapper';
export { parseAmount, splitIgv, parseUserDate as parseDate, cleanText } from './utils';

export async function scrape(config: ScraperConfig): Promise<VentaItem[]> {
  ensureDir(config.outputDir);

  const profile = getProfile(config.siteProfile);
  const { browser, context, page } = await createBrowser(config);

  try {
    await ensureAuthenticated(page, config, profile);
    await saveAuthState(context, config.authStatePath || '');

    const { orders, errors } = await extractOrders(page, config, profile);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const { password: _pw, ...safeConfig } = config;
    const extract: FalabellaExtract = {
      extractedAt: new Date().toISOString(),
      config: safeConfig,
      totalOrders: orders.length,
      orders,
    };
    writeFileSync(
      join(config.outputDir, `falabella-${timestamp}.json`),
      JSON.stringify(extract, null, 2),
    );

    if (errors.length > 0) {
      console.warn(`[scraper] ${errors.length} órdenes omitidas por error`);
    }

    return mapOrders(orders);
  } finally {
    await browser.close();
  }
}
