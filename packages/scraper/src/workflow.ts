import type { Browser, BrowserContext, Page } from 'playwright';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { VentaItem } from '@boletas/core';
import type {
  ScraperConfig,
  SiteProfile,
  RawFalabellaOrder,
  ScrapeError,
} from './types';
import { ensureDir } from './utils';
import { createBrowser, ensureAuthenticated, saveAuthState } from './browser';
import { extractPendingOrders, getProfile, hydrateOrderDetails } from './falabella';
import { mapOrders } from './mapper';

export interface WorkflowState {
  step: 'idle' | 'abrir_navegador' | 'login_falabella' | 'filtrar_ventas' | 'leer_detalle' | 'exportar_json' | 'convertir' | 'completado' | 'error';
  failedStep?: string;
  failedStepLabel?: string;
  currentStepIndex: number;
  browserReady: boolean;
  authenticated: boolean;
  pendingOrderCount: number;
  totalReviewed: number;
  extractedCount: number;
  exportedCount: number;
  convertedCount: number;
  errors: ScrapeError[];
}

export interface StepPreview {
  step: string;
  label: string;
  description: string;
  canRun: boolean;
}

export interface StepResult {
  step: string;
  success: boolean;
  summary: string;
  data?: unknown;
  errors: ScrapeError[];
}

export type StepCallback = (state: WorkflowState, preview: StepPreview) => void;

export class FalabellaWorkflow {
  private config: ScraperConfig;
  private profile: SiteProfile;
  private state: WorkflowState;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private pendingRows: RawFalabellaOrder[] = [];
  private extractedOrders: RawFalabellaOrder[] = [];
  private ventas: VentaItem[] = [];
  private outputPath = '';

  constructor(config: ScraperConfig) {
    this.config = config;
    this.profile = getProfile(config.siteProfile);
    this.state = {
      step: 'idle',
      failedStep: undefined,
      failedStepLabel: undefined,
      currentStepIndex: 0,
      browserReady: false,
      authenticated: false,
      pendingOrderCount: 0,
      totalReviewed: 0,
      extractedCount: 0,
      exportedCount: 0,
      convertedCount: 0,
      errors: [],
    };
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  getPreview(): StepPreview {
    switch (this.state.step) {
      case 'idle':
      case 'abrir_navegador':
        return {
          step: 'abrir_navegador',
          label: 'Abrir navegador',
          description: `Iniciar Chromium (${this.config.headless ? 'headless' : 'visible'}) y cargar sesión guardada si existe.`,
          canRun: true,
        };
      case 'login_falabella':
        return {
          step: 'login_falabella',
          label: 'Iniciar sesión en Falabella',
          description: 'Navegar a Falabella Seller Center y autenticar con las credenciales configuradas (Keycloak o login directo).',
          canRun: this.state.browserReady,
        };
      case 'filtrar_ventas':
        return {
          step: 'filtrar_ventas',
          label: 'Buscar órdenes sin documento',
          description: `Navegar a Documentos Tributarios${this.config.dateFrom ? ` desde ${this.config.dateFrom}` : ''}${this.config.dateTo ? ` hasta ${this.config.dateTo}` : ''}, paginar todas las órdenes y detectar las que no tienen comprobante emitido.`,
          canRun: this.state.authenticated,
        };
      case 'leer_detalle':
        return {
          step: 'leer_detalle',
          label: 'Leer detalle de ventas',
          description: `Se encontraron ${this.state.pendingOrderCount} órdenes sin documento. Abrir el detalle de cada una para extraer: productos, cantidades, precios, datos del cliente (DNI/RUC, nombre).`,
          canRun: this.state.pendingOrderCount > 0,
        };
      case 'exportar_json':
        return {
          step: 'exportar_json',
          label: 'Exportar JSON',
          description: `Se extrajeron ${this.state.extractedCount} órdenes con datos completos. Guardar JSON crudo en ${this.config.outputDir}/falabella-*.json.`,
          canRun: this.state.extractedCount > 0,
        };
      case 'convertir':
        return {
          step: 'convertir',
          label: 'Convertir a formato SUNAT',
          description: `Convertir ${this.state.extractedCount} órdenes de Falabella al formato VentaItem requerido por SUNAT (DNI/RUC → tipoDocumento, IGV 18%, unidad NIU, moneda PEN).`,
          canRun: this.extractedOrders.length > 0,
        };
      default:
        return {
          step: 'completado',
          label: 'Completado',
          description: `Workflow finalizado. ${this.ventas.length} ventas listas para emitir comprobantes.`,
          canRun: false,
        };
    }
  }

  async abrirNavegador(): Promise<StepResult> {
    this.state.step = 'abrir_navegador';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    try {
      const { browser, context, page } = await createBrowser(this.config);
      this.browser = browser;
      this.context = context;
      this.page = page;
      this.state.browserReady = true;
      this.state.step = 'login_falabella';
      this.state.currentStepIndex = 1;

      return {
        step: 'abrir_navegador',
        success: true,
        summary: 'Navegador Chromium iniciado correctamente.',
        errors,
      };
    } catch (e: any) {
      const screenshotPath = await this.captureStepScreenshot('abrir_navegador');
      const htmlPath = await this.captureStepHtml('abrir_navegador');
      this.failStep('abrir_navegador', 'Abrir navegador', e.message, errors, screenshotPath, htmlPath);
      return {
        step: 'abrir_navegador',
        success: false,
        summary: `Error al abrir navegador: ${e.message}`,
        errors,
      };
    }
  }

  async loginFalabella(): Promise<StepResult> {
    if (!this.page) {
      return this.stepError('login_falabella', 'Navegador no inicializado. Ejecuta abrirNavegador primero.');
    }

    this.state.step = 'login_falabella';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    try {
      await ensureAuthenticated(this.page, this.config, this.profile);
      if (this.config.authStatePath && this.context) {
        await saveAuthState(this.context, this.config.authStatePath);
      }
      this.state.authenticated = true;
      this.state.step = 'filtrar_ventas';
      this.state.currentStepIndex = 2;

      return {
        step: 'login_falabella',
        success: true,
        summary: 'Sesión iniciada correctamente en Falabella Seller Center.',
        errors,
      };
    } catch (e: any) {
      const screenshotPath = await this.captureStepScreenshot('login_falabella');
      const htmlPath = await this.captureStepHtml('login_falabella');
      this.failStep('login_falabella', 'Iniciar sesión', e.message, errors, screenshotPath, htmlPath);
      return {
        step: 'login_falabella',
        success: false,
        summary: `Error al iniciar sesión: ${e.message}`,
        errors,
      };
    }
  }

  async filtrarVentasPendientes(): Promise<StepResult> {
    if (!this.page) {
      return this.stepError('filtrar_ventas', 'Navegador no inicializado. Ejecuta abrirNavegador y loginFalabella primero.');
    }

    this.state.step = 'filtrar_ventas';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    try {
      await ensureAuthenticated(this.page, this.config, this.profile);
      this.state.authenticated = true;
      const result = await extractPendingOrders(this.page, this.config, this.profile);
      this.pendingRows = result.orders;
      errors.push(...result.errors);

      this.state.pendingOrderCount = this.pendingRows.length;
      this.state.totalReviewed = result.totalReviewed;

      if (this.pendingRows.length === 0 && errors.length > 0) {
        const screenshotPath = await this.captureStepScreenshot('filtrar_ventas');
        const htmlPath = await this.captureStepHtml('filtrar_ventas');
        if (screenshotPath && !errors[0].screenshotPath) errors[0].screenshotPath = screenshotPath;
        if (htmlPath && !errors[0].htmlPath) errors[0].htmlPath = htmlPath;
        this.state.step = 'error';
        this.state.failedStep = 'filtrar_ventas';
        this.state.failedStepLabel = 'Buscar órdenes sin documento';
        this.state.errors.push(...errors);
        this.state.currentStepIndex = 2;

        return {
          step: 'filtrar_ventas',
          success: false,
          summary: `Error al buscar órdenes sin documento: ${errors[0].reason}`,
          data: { totalOrders: 0 },
          errors,
        };
      }

      this.state.errors.push(...errors);
      this.state.step = this.pendingRows.length > 0 ? 'leer_detalle' : 'completado';
      this.state.currentStepIndex = 3;

      return {
        step: 'filtrar_ventas',
        success: true,
        summary: `Se encontraron ${this.pendingRows.length} órdenes sin documento${errors.length > 0 ? ` (${errors.length} errores en filas)` : ''}.`,
        data: { totalOrders: this.pendingRows.length },
        errors,
      };
    } catch (e: any) {
      const message = e.message || 'Error desconocido';
      const authFailure = isAuthenticationFailure(message);
      const screenshotPath = await this.captureStepScreenshot(authFailure ? 'login_falabella' : 'filtrar_ventas');
      const htmlPath = await this.captureStepHtml(authFailure ? 'login_falabella' : 'filtrar_ventas');
      if (authFailure) this.state.authenticated = false;
      this.failStep(
        authFailure ? 'login_falabella' : 'filtrar_ventas',
        authFailure ? 'Iniciar sesión' : 'Buscar órdenes sin documento',
        message,
        errors,
        screenshotPath,
        htmlPath,
      );
      return {
        step: authFailure ? 'login_falabella' : 'filtrar_ventas',
        success: false,
        summary: authFailure ? `Error al iniciar sesión: ${message}` : `Error al buscar órdenes sin documento: ${message}`,
        errors,
      };
    }
  }

  async leerDetalleVentas(): Promise<StepResult> {
    if (!this.page) {
      return this.stepError('leer_detalle', 'Navegador no inicializado.');
    }
    if (this.pendingRows.length === 0) {
      return this.stepError('leer_detalle', 'No hay órdenes sin documento. Ejecuta Buscar órdenes sin documento primero.');
    }

    this.state.step = 'leer_detalle';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    this.extractedOrders = await hydrateOrderDetails(this.page, this.pendingRows, errors);

    const validOrders = this.extractedOrders.filter(
      o => o.clientDocNumber && o.clientName,
    );
    this.state.extractedCount = validOrders.length;
    this.state.errors.push(...errors);
    this.state.step = validOrders.length > 0 ? 'exportar_json' : 'error';
    if (validOrders.length === 0) {
      this.state.failedStep = 'leer_detalle';
      this.state.failedStepLabel = 'Leer detalle de ventas';
      const screenshotPath = await this.captureStepScreenshot('leer_detalle');
      const htmlPath = await this.captureStepHtml('leer_detalle');
      if (errors.length > 0) {
        errors[0].screenshotPath = errors[0].screenshotPath || screenshotPath;
        errors[0].htmlPath = errors[0].htmlPath || htmlPath;
      } else {
        const reason = 'No se pudo leer ningún detalle de venta con datos completos.';
        const error = {
          orderIndex: -1,
          page: 0,
          reason,
          step: 'leer_detalle',
          stepLabel: 'Leer detalle de ventas',
          screenshotPath,
          htmlPath,
        };
        errors.push(error);
        this.state.errors.push(error);
      }
    }
    this.state.currentStepIndex = 4;

    return {
      step: 'leer_detalle',
      success: validOrders.length > 0,
      summary: `${validOrders.length} de ${this.extractedOrders.length} órdenes tienen datos completos (DNI + nombre). ${this.extractedOrders.length - validOrders.length} órdenes descartadas por datos incompletos.`,
      data: {
        validOrders: validOrders.length,
        totalOrders: this.extractedOrders.length,
        missingData: this.extractedOrders.length - validOrders.length,
      },
      errors,
    };
  }

  async exportarJson(): Promise<StepResult> {
    if (this.extractedOrders.length === 0) {
      return this.stepError('exportar_json', 'No hay órdenes extraídas. Ejecuta leerDetalleVentas primero.');
    }

    this.state.step = 'exportar_json';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    try {
      ensureDir(this.config.outputDir);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const { password: _pw, ...safeConfig } = this.config;

      const extract = {
        extractedAt: new Date().toISOString(),
        config: safeConfig,
        totalOrders: this.extractedOrders.length,
        orders: this.extractedOrders,
      };

      this.outputPath = join(this.config.outputDir, `falabella-${timestamp}.json`);
      writeFileSync(this.outputPath, JSON.stringify(extract, null, 2));

      this.state.exportedCount = this.extractedOrders.length;
      this.state.step = 'convertir';
      this.state.currentStepIndex = 5;

      return {
        step: 'exportar_json',
        success: true,
        summary: `JSON crudo guardado: ${this.extractedOrders.length} órdenes en ${this.outputPath}.`,
        data: {
          outputPath: this.outputPath,
          totalOrders: this.extractedOrders.length,
        },
        errors,
      };
    } catch (e: any) {
      const screenshotPath = await this.captureStepScreenshot('exportar_json');
      const htmlPath = await this.captureStepHtml('exportar_json');
      this.failStep('exportar_json', 'Exportar JSON', e.message, errors, screenshotPath, htmlPath);
      return {
        step: 'exportar_json',
        success: false,
        summary: `Error al exportar: ${e.message}`,
        errors,
      };
    }
  }

  async convertirAVentaItems(): Promise<StepResult> {
    if (this.extractedOrders.length === 0) {
      return this.stepError('convertir', 'No hay órdenes extraídas. Ejecuta los pasos anteriores primero.');
    }

    this.state.step = 'convertir';
    this.clearFailure();
    const errors: ScrapeError[] = [];

    try {
      this.ventas = mapOrders(this.extractedOrders);
      this.state.convertedCount = this.ventas.length;
      this.state.step = 'completado';
      this.state.currentStepIndex = 6;

      return {
        step: 'convertir',
        success: true,
        summary: `Convertidas ${this.ventas.length} órdenes a formato VentaItem (SUNAT). ${this.extractedOrders.length - this.ventas.length} descartadas por datos incompletos.`,
        data: {
          totalConverted: this.ventas.length,
          totalRaw: this.extractedOrders.length,
          discarded: this.extractedOrders.length - this.ventas.length,
        },
        errors,
      };
    } catch (e: any) {
      const screenshotPath = await this.captureStepScreenshot('convertir');
      const htmlPath = await this.captureStepHtml('convertir');
      this.failStep('convertir', 'Convertir a formato SUNAT', e.message, errors, screenshotPath, htmlPath);
      return {
        step: 'convertir',
        success: false,
        summary: `Error al convertir: ${e.message}`,
        errors,
      };
    }
  }

  getRawOrders(): RawFalabellaOrder[] {
    return this.extractedOrders;
  }

  getVentas(): VentaItem[] {
    return this.ventas;
  }

  getOutputPath(): string {
    return this.outputPath;
  }

  loadOrders(orders: RawFalabellaOrder[]): void {
    this.extractedOrders = orders;
    this.pendingRows = orders;
    this.state.extractedCount = orders.length;
    this.state.exportedCount = orders.length;
    this.state.pendingOrderCount = orders.length;
    this.state.totalReviewed = orders.length;
    this.state.step = 'convertir';
    this.state.currentStepIndex = 5;
  }

  async runAll(onStep?: StepCallback): Promise<{ ventas: VentaItem[]; state: WorkflowState }> {
    const steps: Array<{
      name: string;
      fn: () => Promise<StepResult>;
    }> = [
      { name: 'abrir_navegador', fn: () => this.abrirNavegador() },
      { name: 'login_falabella', fn: () => this.loginFalabella() },
      { name: 'filtrar_ventas', fn: () => this.filtrarVentasPendientes() },
      { name: 'leer_detalle', fn: () => this.leerDetalleVentas() },
      { name: 'exportar_json', fn: () => this.exportarJson() },
      { name: 'convertir', fn: () => this.convertirAVentaItems() },
    ];

    for (const step of steps) {
      const preview = this.getPreview();
      onStep?.(this.getState(), preview);

      const result = await step.fn();
      if (!result.success) break;
    }

    return { ventas: this.ventas, state: this.getState() };
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      if (this.config.authStatePath && this.context) {
        await saveAuthState(this.context, this.config.authStatePath);
      }
      await this.browser.close();
    }
  }

  private stepError(step: string, reason: string): StepResult {
    this.state.step = 'error';
    this.state.failedStep = step;
    this.state.failedStepLabel = this.getStepLabel(step);
    const error = { orderIndex: -1, page: 0, reason, step, stepLabel: this.getStepLabel(step) };
    this.state.errors.push(error);
    return {
      step,
      success: false,
      summary: reason,
      errors: [error],
    };
  }

  private failStep(step: string, stepLabel: string, reason: string, errors: ScrapeError[], screenshotPath?: string, htmlPath?: string): void {
    const error = { orderIndex: -1, page: 0, reason, step, stepLabel, screenshotPath, htmlPath };
    errors.push(error);
    this.state.step = 'error';
    this.state.failedStep = step;
    this.state.failedStepLabel = stepLabel;
    this.state.errors.push(...errors);
  }

  private clearFailure(): void {
    this.state.failedStep = undefined;
    this.state.failedStepLabel = undefined;
  }

  private getStepLabel(step: string): string {
    const labels: Record<string, string> = {
      abrir_navegador: 'Abrir navegador',
      login_falabella: 'Iniciar sesión',
      filtrar_ventas: 'Buscar órdenes sin documento',
      leer_detalle: 'Leer detalle de ventas',
      exportar_json: 'Exportar JSON',
      convertir: 'Convertir a formato SUNAT',
    };
    return labels[step] ?? step;
  }

  private async captureStepScreenshot(step: string): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      const screenshotDir = join(this.config.outputDir || '.', 'screenshots');
      ensureDir(screenshotDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = join(screenshotDir, `${step}-${timestamp}.png`);
      await this.page.screenshot({ path: filePath, fullPage: true });
      return filePath;
    } catch {
      return undefined;
    }
  }

  private async captureStepHtml(step: string): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      const screenshotDir = join(this.config.outputDir || '.', 'screenshots');
      ensureDir(screenshotDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = join(screenshotDir, `${step}-${timestamp}.html`);
      const html = await this.page.content();
      const diagnostics = await this.page.evaluate(() => {
        const shadowRoots: string[] = [];
        const walk = (root: ParentNode, path: string) => {
          root.querySelectorAll('*').forEach((element, index) => {
            const currentPath = `${path} > ${element.tagName.toLowerCase()}:nth(${index})`;
            const anyElement = element as HTMLElement & { shadowRoot?: ShadowRoot };
            if (anyElement.shadowRoot) {
              shadowRoots.push(`\n--- ${currentPath} shadowRoot ---\n${anyElement.shadowRoot.innerHTML}`);
              walk(anyElement.shadowRoot, `${currentPath}::shadow`);
            }
          });
        };
        walk(document, 'document');

        return {
          url: location.href,
          title: document.title,
          visibleText: document.body?.innerText || '',
          activeElement: document.activeElement
            ? (document.activeElement as HTMLElement).outerHTML?.slice(0, 4000) || ''
            : '',
          shadowRoots: shadowRoots.join('\n'),
        };
      }).catch(() => ({
        url: '',
        title: '',
        visibleText: '',
        activeElement: '',
        shadowRoots: '',
      }));
      const frameDiagnostics = await Promise.all(
        this.page.frames().map(async (frame, index) => {
          try {
            return [
              `--- FRAME ${index} ---`,
              `URL: ${frame.url()}`,
              `TITLE: ${await frame.title().catch(() => '')}`,
              `VISIBLE_TEXT:\n${await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '')}`,
              `HTML:\n${await frame.content().catch(() => '')}`,
            ].join('\n');
          } catch {
            return `--- FRAME ${index} ---\nURL: ${frame.url()}\nUNREADABLE`;
          }
        }),
      );
      const diagnosticHeader = [
        '<!--',
        'SCRAPER_DIAGNOSTICS_START',
        `URL: ${diagnostics.url}`,
        `TITLE: ${diagnostics.title}`,
        'ACTIVE_ELEMENT:',
        diagnostics.activeElement,
        'VISIBLE_TEXT:',
        diagnostics.visibleText,
        'SHADOW_ROOTS:',
        diagnostics.shadowRoots,
        'FRAMES:',
        frameDiagnostics.join('\n\n'),
        'SCRAPER_DIAGNOSTICS_END',
        '-->',
        '',
      ].join('\n');
      writeFileSync(filePath, diagnosticHeader + html, 'utf-8');
      return filePath;
    } catch {
      return undefined;
    }
  }
}

function isAuthenticationFailure(reason: string): boolean {
  return /\[(falabella login|keycloak)|sesi[oó]n .*login|pantalla de login|no se pudo autenticar|no se pudo confirmar la sesi[oó]n/i.test(reason);
}
