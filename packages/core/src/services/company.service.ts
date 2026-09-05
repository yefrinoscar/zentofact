import { db } from '../db';
import { companies, branches, dailySummaries } from '../db/schema';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { parsePem, parsePfxToPem } from '../utils/certificate';

export type CompanyRecord = typeof companies.$inferSelect;

export interface CreateCompanyInput {
  nombre?: string;
  ruc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  ubigeo?: string;
  distrito?: string;
  provincia?: string;
  departamento?: string;
  telefono?: string;
  email?: string;
  usuarioSol?: string;
  claveSol?: string;
  certificado?: string;
  certificadoPassword?: string;
  sellerUsername?: string;
  sellerPassword?: string;
  falabellaApiUserId?: string;
  falabellaApiKey?: string;
  ripleyApiKey?: string;
  ripleyShopId?: string;
  ripleySvcUsername?: string;
  ripleySvcPassword?: string;
  ripleySvcBaseUrl?: string;
}

export interface UpdateCompanyInput extends Partial<CreateCompanyInput> {}
export type SunatEnvironment = 'beta' | 'produccion';

/** DTO seguro para HTTP: nunca incluye contraseñas, PFX ni API keys. */
export type PublicCompany = {
  id: number;
  nombre: string | null;
  ruc: string;
  razonSocial: string;
  nombreComercial: string | null;
  direccion: string | null;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  departamento: string | null;
  telefono: string | null;
  email: string | null;
  /** Identificadores operativos (no secretos). */
  usuarioSol: string | null;
  sellerUsername: string | null;
  falabellaApiUserId: string | null;
  ripleyShopId: string | null;
  ripleySvcUsername: string | null;
  ripleySvcBaseUrl: string | null;
  mercadoLibreUserId: string | null;
  mercadoLibreSiteId: string | null;
  logoPath: string | null;
  activo: boolean | null;
  createdAt: number | null;
  updatedAt: number | null;
  hasSolCredentials: boolean;
  hasCertificate: boolean;
  hasSellerPassword: boolean;
  hasFalabellaCredentials: boolean;
  hasRipleyCredentials: boolean;
  hasRipleySvcCredentials: boolean;
  hasMercadoLibreCredentials: boolean;
};

export interface MercadoLibreGrantInput {
  userId: string;
  siteId?: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TestSunatConnectionResult {
  success: boolean;
  severity: 'success' | 'warning' | 'error';
  environment: SunatEnvironment;
  endpoint: string;
  authAccepted: boolean;
  certificateValid: boolean;
  code?: string;
  message: string;
  rawStatusCode?: string;
  rawContent?: string;
}

const SUNAT_BETA_ENDPOINT = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';
const SUNAT_PROD_ENDPOINT = 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService';
const PRODUCTION_DUMMY_TICKETS = ['202620699999999', '202600000000001'];

function hasText(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

/** Solo aplica secretos no vacíos en updates (vacío = conservar el valor almacenado). */
function nonEmptySecret(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? String(value) : undefined;
}

export function toPublicCompany(row: CompanyRecord): PublicCompany {
  const hasSolPassword = hasText(row.claveSol);
  const hasCertificate = hasText(row.certificado);
  const hasSellerPassword = hasText(row.sellerPassword);
  const hasFalabellaApiKey = hasText(row.falabellaApiKey);
  const hasRipleyApiKey = hasText(row.ripleyApiKey);
  const hasRipleySvcPassword = hasText(row.ripleySvcPassword);
  return {
    id: row.id,
    nombre: row.nombre ?? null,
    ruc: row.ruc,
    razonSocial: row.razonSocial,
    nombreComercial: row.nombreComercial ?? null,
    direccion: row.direccion ?? null,
    ubigeo: row.ubigeo ?? null,
    distrito: row.distrito ?? null,
    provincia: row.provincia ?? null,
    departamento: row.departamento ?? null,
    telefono: row.telefono ?? null,
    email: row.email ?? null,
    usuarioSol: row.usuarioSol ?? null,
    sellerUsername: row.sellerUsername ?? null,
    falabellaApiUserId: row.falabellaApiUserId ?? null,
    ripleyShopId: row.ripleyShopId ?? null,
    ripleySvcUsername: row.ripleySvcUsername ?? null,
    ripleySvcBaseUrl: row.ripleySvcBaseUrl ?? null,
    mercadoLibreUserId: row.mercadoLibreUserId ?? null,
    mercadoLibreSiteId: row.mercadoLibreSiteId ?? null,
    logoPath: row.logoPath ?? null,
    activo: row.activo ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    hasSolCredentials: hasText(row.usuarioSol) && hasSolPassword,
    hasCertificate,
    hasSellerPassword,
    hasFalabellaCredentials: hasText(row.falabellaApiUserId) && hasFalabellaApiKey,
    hasRipleyCredentials: hasRipleyApiKey,
    hasRipleySvcCredentials: hasText(row.ripleySvcUsername) && hasRipleySvcPassword && hasText(row.ripleySvcBaseUrl),
    hasMercadoLibreCredentials: hasText(row.mercadoLibreRefreshToken),
  };
}

/** Uso interno del backend (SUNAT, Falabella, workflow). No devolver por HTTP. */
export function listCompanies() {
  return db.select().from(companies).where(eq(companies.activo, true));
}

/** Uso interno del backend. No devolver por HTTP. */
export async function getCompany(id: number) {
  const rows = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return rows[0];
}

export async function listPublicCompanies(): Promise<PublicCompany[]> {
  const rows = await listCompanies();
  return rows.map(toPublicCompany);
}

/** Una cuenta de Mercado Libre no puede estar conectada a dos empresas. */
export async function getCompanyByMercadoLibreUserId(userId: string): Promise<CompanyRecord | undefined> {
  const id = String(userId || '').trim();
  if (!id) return undefined;
  const rows = await db.select().from(companies).where(eq(companies.mercadoLibreUserId, id)).limit(1);
  return rows[0];
}

export async function getPublicCompany(id: number): Promise<PublicCompany | undefined> {
  const row = await getCompany(id);
  return row ? toPublicCompany(row) : undefined;
}

export async function createCompany(data: CreateCompanyInput): Promise<PublicCompany> {
  const now = Math.floor(Date.now() / 1000);
  const inserted = await db.insert(companies).values({
    nombre: data.nombre || data.razonSocial,
    ruc: data.ruc,
    razonSocial: data.razonSocial,
    nombreComercial: data.nombreComercial,
    direccion: data.direccion,
    ubigeo: data.ubigeo,
    distrito: data.distrito,
    provincia: data.provincia,
    departamento: data.departamento,
    telefono: data.telefono,
    email: data.email,
    usuarioSol: data.usuarioSol,
    claveSol: data.claveSol,
    certificado: data.certificado,
    certificadoPassword: data.certificadoPassword,
    sellerUsername: data.sellerUsername,
    sellerPassword: data.sellerPassword,
    falabellaApiUserId: data.falabellaApiUserId,
    falabellaApiKey: data.falabellaApiKey,
    ripleyApiKey: data.ripleyApiKey,
    ripleyShopId: data.ripleyShopId,
    ripleySvcUsername: data.ripleySvcUsername,
    ripleySvcPassword: data.ripleySvcPassword,
    ripleySvcBaseUrl: data.ripleySvcBaseUrl,
    activo: true,
    createdAt: now,
    updatedAt: now,
  }).returning();
  const result = inserted[0];

  if (result) {
    await db.insert(branches).values({
      companyId: result.id,
      codigo: '0000',
      nombre: 'Principal',
      direccion: data.direccion,
      ubigeo: data.ubigeo,
      activo: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return toPublicCompany(result);
}

export async function updateCompany(id: number, data: UpdateCompanyInput): Promise<PublicCompany | undefined> {
  const now = Math.floor(Date.now() / 1000);
  const updates: Record<string, any> = { updatedAt: now };
  if (data.ruc !== undefined) updates.ruc = data.ruc;
  if (data.nombre !== undefined) updates.nombre = data.nombre;
  if (data.razonSocial !== undefined) updates.razonSocial = data.razonSocial;
  if (data.nombreComercial !== undefined) updates.nombreComercial = data.nombreComercial;
  if (data.direccion !== undefined) updates.direccion = data.direccion;
  if (data.ubigeo !== undefined) updates.ubigeo = data.ubigeo;
  if (data.distrito !== undefined) updates.distrito = data.distrito;
  if (data.provincia !== undefined) updates.provincia = data.provincia;
  if (data.departamento !== undefined) updates.departamento = data.departamento;
  if (data.telefono !== undefined) updates.telefono = data.telefono;
  if (data.email !== undefined) updates.email = data.email;
  if (data.usuarioSol !== undefined) updates.usuarioSol = data.usuarioSol;
  // Secretos: solo se reemplazan si el cliente envía un valor no vacío.
  const claveSol = nonEmptySecret(data.claveSol);
  if (claveSol !== undefined) updates.claveSol = claveSol;
  const certificado = nonEmptySecret(data.certificado);
  if (certificado !== undefined) updates.certificado = certificado;
  const certificadoPassword = nonEmptySecret(data.certificadoPassword);
  if (certificadoPassword !== undefined) updates.certificadoPassword = certificadoPassword;
  if (data.sellerUsername !== undefined) updates.sellerUsername = data.sellerUsername;
  const sellerPassword = nonEmptySecret(data.sellerPassword);
  if (sellerPassword !== undefined) updates.sellerPassword = sellerPassword;
  if (data.falabellaApiUserId !== undefined) updates.falabellaApiUserId = data.falabellaApiUserId;
  const falabellaApiKey = nonEmptySecret(data.falabellaApiKey);
  if (falabellaApiKey !== undefined) updates.falabellaApiKey = falabellaApiKey;
  if (data.ripleyShopId !== undefined) updates.ripleyShopId = data.ripleyShopId;
  if (data.ripleySvcUsername !== undefined) updates.ripleySvcUsername = data.ripleySvcUsername;
  if (data.ripleySvcBaseUrl !== undefined) updates.ripleySvcBaseUrl = data.ripleySvcBaseUrl;
  const ripleyApiKey = nonEmptySecret(data.ripleyApiKey);
  if (ripleyApiKey !== undefined) updates.ripleyApiKey = ripleyApiKey;
  const ripleySvcPassword = nonEmptySecret(data.ripleySvcPassword);
  if (ripleySvcPassword !== undefined) updates.ripleySvcPassword = ripleySvcPassword;

  const updated = await db.update(companies).set(updates).where(eq(companies.id, id)).returning();
  const row = updated[0];
  return row ? toPublicCompany(row) : undefined;
}

export async function deleteCompany(id: number) {
  const now = Math.floor(Date.now() / 1000);
  return db.update(companies).set({ activo: false, updatedAt: now }).where(eq(companies.id, id));
}

export async function setMercadoLibreGrant(id: number, grant: MercadoLibreGrantInput): Promise<PublicCompany> {
  const userId = String(grant.userId || '').trim();
  const accessToken = String(grant.accessToken || '').trim();
  const refreshToken = String(grant.refreshToken || '').trim();
  const expiresAt = Number(grant.expiresAt);
  if (!userId || !accessToken || !refreshToken || !Number.isFinite(expiresAt)) {
    throw new Error('Falta el grant de Mercado Libre.');
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const updated = await db.update(companies).set({
      mercadoLibreUserId: userId,
      mercadoLibreSiteId: String(grant.siteId || 'MPE').trim() || 'MPE',
      mercadoLibreAccessToken: accessToken,
      mercadoLibreRefreshToken: refreshToken,
      mercadoLibreTokenExpiresAt: Math.trunc(expiresAt),
      updatedAt: now,
    }).where(eq(companies.id, id)).returning();
    const row = updated[0];
    if (!row) throw new Error('Empresa no encontrada.');
    return toPublicCompany(row);
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('Esa cuenta de Mercado Libre ya está conectada a otra empresa.');
    }
    throw error;
  }
}

export async function clearMercadoLibreGrant(id: number): Promise<PublicCompany> {
  const now = Math.floor(Date.now() / 1000);
  const updated = await db.update(companies).set({
    mercadoLibreUserId: null,
    mercadoLibreSiteId: null,
    mercadoLibreAccessToken: null,
    mercadoLibreRefreshToken: null,
    mercadoLibreTokenExpiresAt: null,
    updatedAt: now,
  }).where(eq(companies.id, id)).returning();
  const row = updated[0];
  if (!row) throw new Error('Empresa no encontrada.');
  return toPublicCompany(row);
}

export async function testSunatConnection(companyId: number, environment: SunatEnvironment = 'beta'): Promise<TestSunatConnectionResult> {
  const company = await getCompany(companyId);
  if (!company || !company.activo) {
    return {
      success: false,
      severity: 'error',
      environment,
      endpoint: SUNAT_BETA_ENDPOINT,
      authAccepted: false,
      certificateValid: false,
      code: 'COMPANY_NOT_FOUND',
      message: 'Empresa no encontrada o inactiva.',
    };
  }

  const endpoint = environment === 'produccion' ? SUNAT_PROD_ENDPOINT : SUNAT_BETA_ENDPOINT;

  if (!company.ruc?.trim()) {
    return fail(environment, endpoint, 'RUC_REQUIRED', 'Falta el RUC de la empresa.');
  }
  if (!company.usuarioSol?.trim()) {
    return fail(environment, endpoint, 'SOL_USER_REQUIRED', 'Falta el usuario SOL.');
  }
  if (!company.claveSol?.trim()) {
    return fail(environment, endpoint, 'SOL_PASSWORD_REQUIRED', 'Falta la clave SOL.');
  }
  if (!company.certificado?.trim()) {
    return fail(environment, endpoint, 'CERT_REQUIRED', 'Falta el certificado digital.');
  }

  let certificateValid = false;
  const referenceTicket = await getReferenceTicket(companyId, environment);
  const ticketToTest = referenceTicket || getDummyTicket(environment);
  try {
    parseCertificate(company.certificado || '', company.certificadoPassword || '');
    certificateValid = true;
  } catch (error: any) {
    const auth = await pingSunatAuth(endpoint, company.ruc, company.usuarioSol || '', company.claveSol || '', ticketToTest);
    const prodDummyTicketFailure = isInconclusiveProdDummyTicketCheck(environment, referenceTicket, ticketToTest, auth);
    return {
      success: false,
      severity: auth.authAccepted || prodDummyTicketFailure ? 'warning' : 'error',
      environment,
      endpoint,
      authAccepted: auth.authAccepted,
      certificateValid: false,
      code: prodDummyTicketFailure ? 'PROD_REFERENCE_TICKET_REQUIRED' : 'CERT_INVALID',
      message: prodDummyTicketFailure
        ? `No se pudo confirmar la autenticación en SUNAT producción porque la empresa todavía no tiene un ticket real guardado y SUNAT devolvió "Internal Error (from server)" al consultar el ticket de prueba ${ticketToTest}. Además, el certificado es inválido: ${error?.message || 'No se pudo procesar el certificado digital.'}`
        : auth.authAccepted
        ? `SUNAT ${environment} acepta las credenciales SOL, pero el certificado es inválido: ${error?.message || 'No se pudo procesar el certificado digital.'}`
        : `No se pudo validar SUNAT ${environment}. Certificado inválido y autenticación SOL no confirmada: ${auth.message}`,
      rawStatusCode: auth.rawStatusCode,
      rawContent: auth.rawContent,
    };
  }

  const auth = await pingSunatAuth(endpoint, company.ruc, company.usuarioSol || '', company.claveSol || '', ticketToTest);
  if (!auth.authAccepted) {
    const noReferenceTicket = environment === 'produccion' && ticketToTest === '0' && auth.code === 'EMPTY_RESPONSE';
    const prodDummyTicketFailure = isInconclusiveProdDummyTicketCheck(environment, referenceTicket, ticketToTest, auth);
    return {
      success: false,
      severity: noReferenceTicket || prodDummyTicketFailure ? 'warning' : 'error',
      environment,
      endpoint,
      authAccepted: false,
      certificateValid,
      code: prodDummyTicketFailure ? 'PROD_REFERENCE_TICKET_REQUIRED' : noReferenceTicket ? 'INCONCLUSIVE' : auth.code,
      message: prodDummyTicketFailure
        ? buildProdReferenceTicketRequiredMessage(ticketToTest)
        : noReferenceTicket
        ? 'No se pudo confirmar la autenticación con el ticket dummy de producción.'
        : auth.message,
      rawStatusCode: auth.rawStatusCode,
      rawContent: auth.rawContent,
    };
  }

  return {
    success: true,
    severity: 'success',
    environment,
    endpoint,
    authAccepted: true,
    certificateValid,
    rawStatusCode: auth.rawStatusCode,
    rawContent: auth.rawContent,
    message: `Conexión correcta con SUNAT ${environment}. Credenciales SOL y certificado validados.${ticketToTest ? ` Ticket verificado: ${ticketToTest}.` : ''}`,
  };
}

function fail(
  environment: 'beta' | 'produccion',
  endpoint: string,
  code: string,
  message: string,
): TestSunatConnectionResult {
  return {
    success: false,
    severity: 'error',
    environment,
    endpoint,
    authAccepted: false,
    certificateValid: false,
    code,
    message,
  };
}

function parseCertificate(raw: string, password: string) {
  if (raw.includes('-----BEGIN')) return parsePem(raw);

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    if (decoded.includes('-----BEGIN')) return parsePem(decoded);
  } catch {}

  return parsePfxToPem(raw, password);
}

async function pingSunatAuth(
  endpoint: string,
  ruc: string,
  usuarioSol: string,
  claveSol: string,
  ticket: string,
): Promise<{ authAccepted: boolean; code: string; message: string; rawStatusCode?: string; rawContent?: string }> {
  const ticketsToTry = ticket ? [ticket] : [];
  if (!ticketsToTry.length) ticketsToTry.push('0');

  let lastFailure: { authAccepted: boolean; code: string; message: string; rawStatusCode?: string; rawContent?: string } | null = null;

  for (const candidateTicket of ticketsToTry) {
    const attempt = await pingSunatAuthOnce(endpoint, ruc, usuarioSol, claveSol, candidateTicket);
    if (attempt.authAccepted) return attempt;
    lastFailure = attempt;
  }

  return lastFailure || {
    authAccepted: false,
    code: 'SUNAT_ERROR',
    message: 'No se pudo conectar con SUNAT.',
  };
}

async function pingSunatAuthOnce(
  endpoint: string,
  ruc: string,
  usuarioSol: string,
  claveSol: string,
  ticket: string,
): Promise<{ authAccepted: boolean; code: string; message: string; rawStatusCode?: string; rawContent?: string }> {
  try {
    const responseText = await postGetStatus(endpoint, ruc, usuarioSol, claveSol, ticket);
    const faultCode = extractXmlValue(responseText, 'faultcode');
    const faultString = extractXmlValue(responseText, 'faultstring');
    if (faultString) {
      return {
        authAccepted: false,
        code: faultCode || 'SOAP_FAULT',
        message: faultString,
      };
    }

    const rawStatusCode = extractXmlValue(responseText, 'statusCode') || '';
    const rawContent = extractXmlValue(responseText, 'content') || '';
    if (rawStatusCode === '0127' || /ticket no existe/i.test(rawContent)) {
      return {
        authAccepted: true,
        code: 'OK',
        message: 'Credenciales SOL aceptadas por SUNAT.',
        rawStatusCode,
        rawContent,
      };
    }

    if (!rawStatusCode && !rawContent) {
      return {
        authAccepted: false,
        code: 'EMPTY_RESPONSE',
        message: ticket === '0'
          ? 'SUNAT no devolvió una respuesta válida para confirmar la autenticación con ticket de prueba.'
          : 'SUNAT no devolvió una respuesta válida para confirmar la autenticación.',
      };
    }

    return {
      authAccepted: true,
      code: 'OK',
      message: rawStatusCode
        ? `SUNAT respondió con código ${rawStatusCode}.`
        : 'SUNAT respondió correctamente.',
      rawStatusCode,
      rawContent,
    };
  } catch (error: any) {
    return {
      authAccepted: false,
      code: error?.code || 'SUNAT_ERROR',
      message: error?.message || 'No se pudo conectar con SUNAT.',
    };
  }
}

async function postGetStatus(
  endpoint: string,
  ruc: string,
  usuarioSol: string,
  claveSol: string,
  ticket: string,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:getStatus',
      'Accept': 'text/xml',
    },
    body: buildGetStatusEnvelope(ruc, usuarioSol, claveSol, ticket),
  });

  return response.text();
}

function buildGetStatusEnvelope(ruc: string, usuarioSol: string, claveSol: string, ticket: string): string {
  const now = new Date();
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const username = usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="Timestamp-${created}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="SecurityToken-${created}">
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(claveSol)}</wsse:Password>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <ticket>${escapeXml(ticket)}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractXmlValue(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, 'i'));
  if (!match) return undefined;
  return decodeXmlEntities(match[1].trim());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

async function getReferenceTicket(companyId: number, environment: SunatEnvironment): Promise<string | null> {
  if (environment !== 'produccion') return null;

  const rows = await db.select({ ticket: dailySummaries.ticket })
    .from(dailySummaries)
    .where(and(
      eq(dailySummaries.companyId, companyId),
      isNotNull(dailySummaries.ticket),
    ))
    .orderBy(desc(dailySummaries.id))
    .limit(1);

  return rows[0]?.ticket || null;
}

function getDummyTicket(environment: SunatEnvironment): string {
  if (environment === 'produccion') return PRODUCTION_DUMMY_TICKETS[0];
  return '0';
}

function isInconclusiveProdDummyTicketCheck(
  environment: SunatEnvironment,
  referenceTicket: string | null,
  ticketToTest: string,
  auth: { authAccepted: boolean; code: string; message: string },
): boolean {
  if (environment !== 'produccion') return false;
  if (referenceTicket) return false;
  if (ticketToTest !== PRODUCTION_DUMMY_TICKETS[0]) return false;
  if (auth.authAccepted) return false;

  return auth.code === 'env:Server' && /internal error/i.test(auth.message);
}

function buildProdReferenceTicketRequiredMessage(ticketToTest: string): string {
  return `SUNAT producción devolvió "Internal Error (from server)" al consultar el ticket de prueba ${ticketToTest}. Esta validación es no concluyente: la empresa todavía no tiene un ticket real guardado en producción, así que no se puede confirmar ni descartar el acceso SOL con este método. Para validarlo de verdad, primero envía un resumen o una boleta real en producción y luego vuelve a probar con ese ticket.`;
}
