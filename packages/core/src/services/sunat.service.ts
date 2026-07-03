import { create } from 'xmlbuilder2';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import { signXml, extractHashFromXml } from '../utils/xml-signer';
import { parsePem, parsePfxToPem } from '../utils/certificate';
import type { CertificateKeys } from '../utils/certificate';

dotenv.config();

const SUNAT_BETA_ENDPOINT = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';
const SUNAT_PROD_ENDPOINT = 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService';

export interface CompanyConfig {
  ruc: string;
  razonSocial: string;
  direccion: string;
  ubigeo: string;
  usuarioSol: string;
  claveSol: string;
  certificado: string;
  certificadoPassword: string;
  modoProduccion: boolean;
  distrito?: string;
  provincia?: string;
  departamento?: string;
  codigoLocal?: string;
}

export interface SendResult {
  success: boolean;
  xml?: string;
  cdrZip?: Buffer;
  cdrResponse?: any;
  ticket?: string;
  error?: { code: string; message: string };
}

export interface SummarySendResult {
  success: boolean;
  xml?: string;
  ticket?: string;
  error?: { code: string; message: string };
}

export interface StatusResult {
  success: boolean;
  cdrZip?: Buffer;
  cdrResponse?: any;
  statusCode?: string;
  statusMessage?: string;
  rawContent?: string;
  error?: { code: string; message: string };
}

export interface BoletaSunatData {
  tipoDocumento: string;
  serie: string;
  correlativo: string;
  fechaEmision: string;
  moneda: string;
  tipoOperacion: string;
  ublVersion: string;
  client: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
    direccion?: string;
  };
  detalles: Array<{
    codigo: string;
    descripcion: string;
    unidad: string;
    cantidad: number;
    mtoValorUnitario: number;
    porcentajeIgv: number;
    tipAfeIgv: string;
    mtoValorGratuito?: number;
    isc?: number;
    icbper?: number;
  }>;
  mtoOperGravadas: number;
  mtoOperExoneradas: number;
  mtoOperInafectas: number;
  mtoOperGratuitas: number;
  mtoIgvGratuitas: number;
  mtoIgv: number;
  mtoBaseIvap: number;
  mtoIvap: number;
  mtoIsc: number;
  mtoIcbper: number;
  totalImpuestos: number;
  subTotal: number;
  mtoImpVenta: number;
  formaPagoTipo?: string;
  leyendas?: Array<{ code: string; value: string }>;
}

export interface CreditNoteSunatData {
  tipoDocumento: string;
  serie: string;
  correlativo: string;
  fechaEmision: string;
  moneda: string;
  ublVersion: string;
  tipoDocAfectado: string;
  numDocAfectado: string;
  codMotivo: string;
  desMotivo: string;
  client: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
    direccion?: string;
  };
  detalles: Array<{
    codigo: string;
    descripcion: string;
    unidad: string;
    cantidad: number;
    mtoValorUnitario: number;
    porcentajeIgv: number;
    tipAfeIgv: string;
    mtoValorGratuito?: number;
    isc?: number;
    icbper?: number;
  }>;
  mtoOperGravadas: number;
  mtoOperExoneradas: number;
  mtoOperInafectas: number;
  mtoOperGratuitas: number;
  mtoIgvGratuitas: number;
  mtoIgv: number;
  mtoBaseIvap: number;
  mtoIvap: number;
  mtoIsc: number;
  mtoIcbper: number;
  totalImpuestos: number;
  subTotal: number;
  mtoImpVenta: number;
  leyendas?: Array<{ code: string; value: string }>;
}

export class SunatService {
  private keys!: CertificateKeys;
  private endpoint: string;

  constructor(private config: CompanyConfig) {
    // Override por ambiente: SUNAT_FORCE_ENV=beta|produccion fuerza el endpoint sin importar
    // la config de la empresa. Local => beta; Railway (prod) => sin flag o 'produccion'.
    const forced = (process.env.SUNAT_FORCE_ENV || '').trim().toLowerCase();
    const useProd = forced === 'produccion' || forced === 'produ' || forced === 'prod'
      ? true
      : forced === 'beta'
        ? false
        : config.modoProduccion;
    this.endpoint = useProd ? SUNAT_PROD_ENDPOINT : SUNAT_BETA_ENDPOINT;
    this.parseCertificate();
  }

  private parseCertificate() {
    try {
      const raw = this.config.certificado || '';
      // Intentar como PEM primero
      if (raw.includes('-----BEGIN')) {
        this.keys = parsePem(raw);
        return;
      }
      // Intentar decodificar base64 y ver si es PEM dentro
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');
        if (decoded.includes('-----BEGIN')) {
          this.keys = parsePem(decoded);
          return;
        }
      } catch {}
      // Tratar como PFX
      this.keys = parsePfxToPem(raw, this.config.certificadoPassword || '');
    } catch (e: any) {
      throw new Error(`Error al procesar certificado digital: ${e.message}`);
    }
  }

  private getCodigoLocal(): string {
    const digits = String(this.config.codigoLocal || '').replace(/\D/g, '');
    return (digits || '0000').padStart(4, '0').slice(-4);
  }

  private appendAddressContent(address: any, includeCodigoLocal = false) {
    address.ele('cbc:ID', { schemeAgencyName: 'PE:INEI', schemeName: 'Ubigeos' }).txt(this.config.ubigeo).up();

    if (includeCodigoLocal) {
      address.ele('cbc:AddressTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Establecimientos anexos',
      }).txt(this.getCodigoLocal()).up();
    }

    address.ele('cac:AddressLine').ele('cbc:Line').txt(this.config.direccion).up().up();
    address.ele('cac:Country')
      .ele('cbc:IdentificationCode', {
        listAgencyName: 'United Nations Economic Commission for Europe',
        listID: 'ISO 3166-1',
        listName: 'Country',
      }).txt('PE').up()
      .up();
  }

  private appendSupplierParty(parent: any) {
    const supplier = parent.ele('cac:AccountingSupplierParty').ele('cac:Party');

    supplier.ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeAgencyName: 'PE:SUNAT',
        schemeID: '6',
        schemeName: 'Documento de Identidad',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      }).txt(this.config.ruc).up()
      .up();

    this.appendAddressContent(supplier.ele('cac:PostalAddress'));

    const legalEntity = supplier.ele('cac:PartyLegalEntity');
    legalEntity.ele('cbc:RegistrationName').txt(this.config.razonSocial).up();
    this.appendAddressContent(legalEntity.ele('cac:RegistrationAddress'), true);
  }

  private appendPaymentTerms(parent: any, data: BoletaSunatData) {
    const paymentType = data.formaPagoTipo === 'Credito' ? 'Credito' : 'Contado';
    const paymentTerms = parent.ele('cac:PaymentTerms');
    paymentTerms.ele('cbc:ID').txt('FormaPago').up();
    paymentTerms.ele('cbc:PaymentMeansID').txt(paymentType).up();

    if (paymentType === 'Credito') {
      paymentTerms.ele('cbc:Amount', { currencyID: data.moneda }).txt(data.mtoImpVenta.toFixed(2)).up();
    }

    paymentTerms.up();
  }

  buildUBLXml(data: BoletaSunatData): string {
    const { issueDate, issueTime } = this.resolveIssueDateTime(data.fechaEmision);

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('Invoice', {
        'xmlns': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:sac': 'urn:sunat:names:specification:peru:schema:xsd:sunataggregatecomponents-1',
      });

    const ext = doc.ele('ext:UBLExtensions').ele('ext:UBLExtension').ele('ext:ExtensionContent');
    ext.up().up().up();

    doc.ele('cbc:UBLVersionID').txt(data.ublVersion).up();
    doc.ele('cbc:CustomizationID').txt('2.0').up();
    doc.ele('cbc:ProfileID', {
      schemeName: 'SUNAT:Identificador de Tipo de Operación',
      schemeAgencyName: 'PE:SUNAT',
      schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo17',
    }).txt(data.tipoOperacion).up();
    doc.ele('cbc:ID').txt(`${data.serie}-${data.correlativo}`).up();
    doc.ele('cbc:IssueDate').txt(issueDate).up();
    doc.ele('cbc:IssueTime').txt(issueTime).up();
    doc.ele('cbc:InvoiceTypeCode', {
      listAgencyName: 'PE:SUNAT',
      listName: 'SUNAT:Identificador de Tipo de Documento',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
      listID: data.tipoOperacion,
    }).txt(data.tipoDocumento).up();
    doc.ele('cbc:DocumentCurrencyCode', { listAgencyName: 'United Nations Economic Commission for Europe', listID: 'ISO 4217 Alpha', listName: 'Currency' }).txt(data.moneda).up();

    this.appendSupplierParty(doc);

    const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
    customer.ele('cac:PartyIdentification').ele('cbc:ID', { schemeAgencyName: 'PE:SUNAT', schemeID: data.client.tipoDocumento, schemeName: 'Documento de Identidad', schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06' }).txt(data.client.numeroDocumento).up().up();

    if (data.client.direccion) {
      customer.ele('cac:PostalAddress').ele('cac:AddressLine').ele('cbc:Line').txt(data.client.direccion).up().up().up();
    }

    customer.ele('cac:PartyLegalEntity').ele('cbc:RegistrationName').txt(data.client.razonSocial).up().up();

    this.appendPaymentTerms(doc, data);

    if (data.mtoIgv > 0) {
      doc.ele('cac:TaxTotal')
        .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(data.mtoIgv.toFixed(2)).up()
        .ele('cac:TaxSubtotal')
          .ele('cbc:TaxableAmount', { currencyID: data.moneda }).txt(data.mtoOperGravadas.toFixed(2)).up()
          .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(data.mtoIgv.toFixed(2)).up()
          .ele('cac:TaxCategory').ele('cac:TaxScheme').ele('cbc:ID').txt('1000').up().ele('cbc:Name').txt('IGV').up().ele('cbc:TaxTypeCode').txt('VAT').up().up().up().up().up();
    }

    doc.ele('cac:LegalMonetaryTotal')
      .ele('cbc:LineExtensionAmount', { currencyID: data.moneda }).txt(data.subTotal.toFixed(2)).up()
      .ele('cbc:TaxInclusiveAmount', { currencyID: data.moneda }).txt(data.mtoImpVenta.toFixed(2)).up()
      .ele('cbc:PayableAmount', { currencyID: data.moneda }).txt(data.mtoImpVenta.toFixed(2)).up().up();

    for (let i = 0; i < data.detalles.length; i++) {
      const det = data.detalles[i];
      const valVta = det.cantidad * det.mtoValorUnitario;
      const igvItem = det.tipAfeIgv === '10' ? valVta * det.porcentajeIgv / 100 : 0;
      const unitPriceWithTax = det.tipAfeIgv === '10'
        ? det.mtoValorUnitario * (1 + det.porcentajeIgv / 100)
        : det.mtoValorUnitario;

      const line = doc.ele('cac:InvoiceLine')
        .ele('cbc:ID').txt(String(i + 1)).up()
        .ele('cbc:InvoicedQuantity', { unitCode: det.unidad }).txt(String(det.cantidad)).up()
        .ele('cbc:LineExtensionAmount', { currencyID: data.moneda }).txt(valVta.toFixed(2)).up();

      line.ele('cac:PricingReference').ele('cac:AlternativeConditionPrice').ele('cbc:PriceAmount', { currencyID: data.moneda }).txt(unitPriceWithTax.toFixed(2)).up().ele('cbc:PriceTypeCode').txt('01').up().up().up();

      if (igvItem > 0) {
        line.ele('cac:TaxTotal').ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(igvItem.toFixed(2)).up()
          .ele('cac:TaxSubtotal').ele('cbc:TaxableAmount', { currencyID: data.moneda }).txt(valVta.toFixed(2)).up()
            .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(igvItem.toFixed(2)).up()
            .ele('cac:TaxCategory').ele('cbc:Percent').txt(String(det.porcentajeIgv)).up()
              .ele('cbc:TaxExemptionReasonCode', { listAgencyName: 'PE:SUNAT', listName: 'Afectacion del IGV', listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07' }).txt(det.tipAfeIgv).up()
              .ele('cac:TaxScheme').ele('cbc:ID').txt('1000').up().ele('cbc:Name').txt('IGV').up().ele('cbc:TaxTypeCode').txt('VAT').up().up().up().up().up();
      }

      line.ele('cac:Item').ele('cbc:Description').txt(det.descripcion).up()
        .ele('cac:SellersItemIdentification').ele('cbc:ID').txt(det.codigo).up().up().up();
      line.ele('cac:Price').ele('cbc:PriceAmount', { currencyID: data.moneda }).txt(det.mtoValorUnitario.toFixed(2)).up().up();
      line.up();
    }

    return doc.end({ prettyPrint: true });
  }

  buildCreditNoteXml(data: CreditNoteSunatData): string {
    const { issueDate, issueTime } = this.resolveIssueDateTime(data.fechaEmision);

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('CreditNote', {
        'xmlns': 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
        'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:sac': 'urn:sunat:names:specification:peru:schema:xsd:sunataggregatecomponents-1',
      });

    const ext = doc.ele('ext:UBLExtensions').ele('ext:UBLExtension').ele('ext:ExtensionContent');
    ext.up().up().up();

    doc.ele('cbc:UBLVersionID').txt(data.ublVersion).up();
    doc.ele('cbc:CustomizationID').txt('2.0').up();
    doc.ele('cbc:ID').txt(`${data.serie}-${data.correlativo}`).up();
    doc.ele('cbc:IssueDate').txt(issueDate).up();
    doc.ele('cbc:IssueTime').txt(issueTime).up();

    for (const leyenda of data.leyendas || []) {
      doc.ele('cbc:Note', { languageLocaleID: leyenda.code }).txt(leyenda.value).up();
    }

    doc.ele('cbc:DocumentCurrencyCode', {
      listAgencyName: 'United Nations Economic Commission for Europe',
      listID: 'ISO 4217 Alpha',
      listName: 'Currency',
    }).txt(data.moneda).up();

    doc.ele('cac:DiscrepancyResponse')
      .ele('cbc:ReferenceID').txt(data.numDocAfectado).up()
      .ele('cbc:ResponseCode').txt(data.codMotivo).up()
      .ele('cbc:Description').txt(data.desMotivo).up()
      .up();

    doc.ele('cac:BillingReference')
      .ele('cac:InvoiceDocumentReference')
      .ele('cbc:ID').txt(data.numDocAfectado).up()
      .ele('cbc:DocumentTypeCode').txt(data.tipoDocAfectado).up()
      .up()
      .up();

    this.appendSupplierParty(doc);

    const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
    customer.ele('cac:PartyIdentification').ele('cbc:ID', { schemeAgencyName: 'PE:SUNAT', schemeID: data.client.tipoDocumento, schemeName: 'Documento de Identidad', schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06' }).txt(data.client.numeroDocumento).up().up();

    if (data.client.direccion) {
      customer.ele('cac:PostalAddress').ele('cac:AddressLine').ele('cbc:Line').txt(data.client.direccion).up().up().up();
    }

    customer.ele('cac:PartyLegalEntity').ele('cbc:RegistrationName').txt(data.client.razonSocial).up().up();

    if (data.totalImpuestos > 0) {
      const taxTotal = doc.ele('cac:TaxTotal')
        .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(data.totalImpuestos.toFixed(2)).up();

      if (data.mtoOperGravadas > 0 || data.mtoIgv > 0) {
        taxTotal
          .ele('cac:TaxSubtotal')
          .ele('cbc:TaxableAmount', { currencyID: data.moneda }).txt(data.mtoOperGravadas.toFixed(2)).up()
          .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(data.mtoIgv.toFixed(2)).up()
          .ele('cac:TaxCategory').ele('cac:TaxScheme')
          .ele('cbc:ID').txt('1000').up().ele('cbc:Name').txt('IGV').up().ele('cbc:TaxTypeCode').txt('VAT').up()
          .up().up().up();
      }

      taxTotal.up();
    }

    doc.ele('cac:LegalMonetaryTotal')
      .ele('cbc:LineExtensionAmount', { currencyID: data.moneda }).txt(data.subTotal.toFixed(2)).up()
      .ele('cbc:TaxInclusiveAmount', { currencyID: data.moneda }).txt(data.mtoImpVenta.toFixed(2)).up()
      .ele('cbc:PayableAmount', { currencyID: data.moneda }).txt(data.mtoImpVenta.toFixed(2)).up()
      .up();

    for (let i = 0; i < data.detalles.length; i++) {
      const det = data.detalles[i];
      const valVta = det.cantidad * det.mtoValorUnitario;
      const igvItem = det.tipAfeIgv === '10' ? valVta * det.porcentajeIgv / 100 : 0;
      const unitPriceWithTax = det.tipAfeIgv === '10'
        ? det.mtoValorUnitario * (1 + det.porcentajeIgv / 100)
        : det.mtoValorUnitario;

      const line = doc.ele('cac:CreditNoteLine')
        .ele('cbc:ID').txt(String(i + 1)).up()
        .ele('cbc:CreditedQuantity', { unitCode: det.unidad }).txt(String(det.cantidad)).up()
        .ele('cbc:LineExtensionAmount', { currencyID: data.moneda }).txt(valVta.toFixed(2)).up();

      line.ele('cac:PricingReference').ele('cac:AlternativeConditionPrice').ele('cbc:PriceAmount', { currencyID: data.moneda }).txt(unitPriceWithTax.toFixed(2)).up().ele('cbc:PriceTypeCode').txt('01').up().up().up();

      if (igvItem > 0) {
        line.ele('cac:TaxTotal').ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(igvItem.toFixed(2)).up()
          .ele('cac:TaxSubtotal').ele('cbc:TaxableAmount', { currencyID: data.moneda }).txt(valVta.toFixed(2)).up()
          .ele('cbc:TaxAmount', { currencyID: data.moneda }).txt(igvItem.toFixed(2)).up()
          .ele('cac:TaxCategory').ele('cbc:Percent').txt(String(det.porcentajeIgv)).up()
          .ele('cbc:TaxExemptionReasonCode', { listAgencyName: 'PE:SUNAT', listName: 'Afectacion del IGV', listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07' }).txt(det.tipAfeIgv).up()
          .ele('cac:TaxScheme').ele('cbc:ID').txt('1000').up().ele('cbc:Name').txt('IGV').up().ele('cbc:TaxTypeCode').txt('VAT').up().up().up().up().up();
      }

      line.ele('cac:Item').ele('cbc:Description').txt(det.descripcion).up()
        .ele('cac:SellersItemIdentification').ele('cbc:ID').txt(det.codigo).up().up().up();
      line.ele('cac:Price').ele('cbc:PriceAmount', { currencyID: data.moneda }).txt(det.mtoValorUnitario.toFixed(2)).up().up();
      line.up();
    }

    return doc.end({ prettyPrint: true });
  }

  async sendDocument(xmlContent: string, fileName: string): Promise<SendResult> {
    let signedXml: string;
    try {
      signedXml = signXml(xmlContent, this.keys.privateKey, this.keys.certificate);
    } catch (e: any) {
      return { success: false, error: { code: 'SIGN_ERROR', message: `[Paso 1/3 - Firmar XML] ${e.message}` } };
    }

    const zip = new AdmZip();
    zip.addFile(`${fileName}.xml`, Buffer.from(signedXml, 'utf-8'));
    const zipContent = zip.toBuffer();

    try {
      let response: any;
      try {
        response = await this.sendBillSoap(`${fileName}.zip`, zipContent.toString('base64'));
      } catch (e: any) {
        return {
          success: false,
          xml: signedXml,
          error: {
            code: e.code || 'SOAP_ERROR',
            message: `[Paso 3/3 - Enviar a SUNAT] ${e.message}`,
          },
        };
      }

      const cdrZip = response?.applicationResponse
        ? Buffer.from(response.applicationResponse.replace(/\s/g, ''), 'base64')
        : undefined;

      const cdrResponse = cdrZip ? this.parseCdrResponse(cdrZip) : null;
      if (cdrResponse?.code && cdrResponse.code !== '0') {
        return {
          success: false,
          xml: signedXml,
          cdrZip,
          cdrResponse,
          error: {
            code: cdrResponse.code,
            message: `[Paso 3/3 - Enviar a SUNAT] ${cdrResponse.description || 'SUNAT rechazó el documento'}`,
          },
        };
      }

      return { success: true, xml: signedXml, cdrZip, cdrResponse };
    } catch (error: any) {
      return {
        success: false,
        xml: signedXml,
        error: {
          code: error?.root?.Envelope?.Body?.Fault?.faultcode || 'SOAP_ERROR',
          message: `[Paso 3/3 - Enviar a SUNAT] ${error?.root?.Envelope?.Body?.Fault?.faultstring || error.message}`,
        },
      };
    }
  }

  async sendSummaryDocument(xmlContent: string, fileName: string): Promise<SummarySendResult> {
    let signedXml: string;
    try {
      signedXml = signXml(xmlContent, this.keys.privateKey, this.keys.certificate);
    } catch (e: any) {
      return { success: false, error: { code: 'SIGN_ERROR', message: `[Paso 1/3 - Firmar XML] ${e.message}` } };
    }

    const zip = new AdmZip();
    zip.addFile(`${fileName}.xml`, Buffer.from(signedXml, 'utf-8'));
    const zipContent = zip.toBuffer();

    try {
      const ticket = await this.sendSummarySoap(`${fileName}.zip`, zipContent.toString('base64'));
      return { success: true, xml: signedXml, ticket };
    } catch (e: any) {
      return {
        success: false,
        xml: signedXml,
        error: {
          code: e.code || 'SOAP_ERROR',
          message: `[Paso 3/3 - Enviar resumen a SUNAT] ${e.message}`,
        },
      };
    }
  }

  async getStatus(ticket: string): Promise<StatusResult> {
    try {
      const response = await this.getStatusSoap(ticket);
      const rawContent = response.content?.trim();
      const cdrZip = this.decodeStatusContent(rawContent);
      const cdrResponse = cdrZip ? this.parseCdrResponse(cdrZip) : undefined;
      return {
        success: true,
        cdrZip,
        cdrResponse,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        rawContent,
      };
    } catch (e: any) {
      return {
        success: false,
        error: {
          code: e.code || 'SOAP_ERROR',
          message: `[Consultar ticket SUNAT] ${e.message}`,
        },
      };
    }
  }

  private decodeStatusContent(content?: string): Buffer | undefined {
    if (!content) return undefined;

    const compact = content.replace(/\s/g, '');
    if (!compact || compact.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(compact)) {
      return undefined;
    }

    const decoded = Buffer.from(compact, 'base64');
    if (decoded.length < 4) return undefined;

    // Un CDR ZIP válido debe arrancar con la firma PK.
    if (decoded[0] !== 0x50 || decoded[1] !== 0x4b) {
      return undefined;
    }

    return decoded;
  }

  private async sendBillSoap(fileName: string, contentFile: string): Promise<{ applicationResponse?: string }> {
    const soapEnvelope = this.buildSendBillEnvelope(fileName, contentFile);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'urn:sendBill',
        'Accept': 'text/xml',
      },
      body: soapEnvelope,
    });

    const responseText = await response.text();
    const fault = this.parseSoapFault(responseText);
    if (fault) {
      const error = new Error(fault.message);
      (error as any).code = fault.code || 'SOAP_FAULT';
      throw error;
    }

    if (!response.ok) {
      const bodyPreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 500);
      const error = new Error(`HTTP ${response.status} ${response.statusText}${bodyPreview ? `: ${bodyPreview}` : ''}`);
      (error as any).code = 'HTTP_ERROR';
      throw error;
    }

    const applicationResponse = this.extractXmlValue(responseText, 'applicationResponse');
    return { applicationResponse };
  }

  private async sendSummarySoap(fileName: string, contentFile: string): Promise<string> {
    const soapEnvelope = this.buildSendSummaryEnvelope(fileName, contentFile);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'urn:sendSummary',
        'Accept': 'text/xml',
      },
      body: soapEnvelope,
    });

    const responseText = await response.text();
    const fault = this.parseSoapFault(responseText);
    if (fault) {
      const error = new Error(fault.message);
      (error as any).code = fault.code || 'SOAP_FAULT';
      throw error;
    }

    if (!response.ok) {
      const bodyPreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 500);
      const error = new Error(`HTTP ${response.status} ${response.statusText}${bodyPreview ? `: ${bodyPreview}` : ''}`);
      (error as any).code = 'HTTP_ERROR';
      throw error;
    }

    const ticket = this.extractXmlValue(responseText, 'ticket');
    if (!ticket) {
      const error = new Error(`SUNAT no devolvió ticket: ${responseText.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
      (error as any).code = 'NO_TICKET';
      throw error;
    }
    return ticket;
  }

  private async getStatusSoap(ticket: string): Promise<{ content?: string; statusCode?: string; statusMessage?: string }> {
    const soapEnvelope = this.buildGetStatusEnvelope(ticket);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'urn:getStatus',
        'Accept': 'text/xml',
      },
      body: soapEnvelope,
    });

    const responseText = await response.text();
    const fault = this.parseSoapFault(responseText);
    if (fault) {
      const error = new Error(fault.message);
      (error as any).code = fault.code || 'SOAP_FAULT';
      throw error;
    }

    if (!response.ok) {
      const bodyPreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 500);
      const error = new Error(`HTTP ${response.status} ${response.statusText}${bodyPreview ? `: ${bodyPreview}` : ''}`);
      (error as any).code = 'HTTP_ERROR';
      throw error;
    }

    return {
      content: this.extractXmlValue(responseText, 'content'),
      statusCode: this.extractXmlValue(responseText, 'statusCode'),
      statusMessage: this.extractXmlValue(responseText, 'statusMessage'),
    };
  }

  private buildSendBillEnvelope(fileName: string, contentFile: string): string {
    const now = new Date();
    const created = this.formatSoapDate(now);
    const expires = this.formatSoapDate(new Date(now.getTime() + 10 * 60 * 1000));
    const username = this.buildSoapUsername();
    const password = this.config.claveSol.trim();

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="Timestamp-${created}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="SecurityToken-${created}">
        <wsse:Username>${this.escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escapeXml(password)}</wsse:Password>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>${this.escapeXml(fileName)}</fileName>
      <contentFile>${contentFile}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildSendSummaryEnvelope(fileName: string, contentFile: string): string {
    const now = new Date();
    const created = this.formatSoapDate(now);
    const expires = this.formatSoapDate(new Date(now.getTime() + 10 * 60 * 1000));
    const username = this.buildSoapUsername();
    const password = this.config.claveSol.trim();

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="Timestamp-${created}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="SecurityToken-${created}">
        <wsse:Username>${this.escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escapeXml(password)}</wsse:Password>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendSummary>
      <fileName>${this.escapeXml(fileName)}</fileName>
      <contentFile>${contentFile}</contentFile>
    </ser:sendSummary>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildGetStatusEnvelope(ticket: string): string {
    const now = new Date();
    const created = this.formatSoapDate(now);
    const expires = this.formatSoapDate(new Date(now.getTime() + 10 * 60 * 1000));
    const username = this.buildSoapUsername();
    const password = this.config.claveSol.trim();

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="Timestamp-${created}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="SecurityToken-${created}">
        <wsse:Username>${this.escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escapeXml(password)}</wsse:Password>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <ticket>${this.escapeXml(ticket)}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildSoapUsername(): string {
    const ruc = this.config.ruc.trim();
    const usuarioSol = this.config.usuarioSol.trim();
    return usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`;
  }

  private parseSoapFault(xml: string): { code: string; message: string } | null {
    const faultString = this.extractXmlValue(xml, 'faultstring');
    if (!faultString) return null;
    return {
      code: this.extractXmlValue(xml, 'faultcode') || 'SOAP_FAULT',
      message: faultString,
    };
  }

  private extractXmlValue(xml: string, tagName: string): string | undefined {
    const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, 'i'));
    if (!match) return undefined;
    return this.decodeXmlEntities(match[1].trim());
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  private formatSoapDate(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  parseCdrResponse(cdrZip: Buffer): any {
    try {
      const zip = new AdmZip(cdrZip);
      for (const entry of zip.getEntries()) {
        if (entry.entryName.endsWith('.xml')) {
          const xmlContent = entry.getData().toString('utf-8');
          const idMatch = xmlContent.match(/<cbc:ID[^>]*>([^<]+)<\/cbc:ID>/);
          const codeMatch = xmlContent.match(/<cbc:ResponseCode[^>]*>([^<]+)<\/cbc:ResponseCode>/);
          const descMatch = xmlContent.match(/<cbc:Description[^>]*>([^<]+)<\/cbc:Description>/);
          return { id: idMatch?.[1] || '', code: codeMatch?.[1] || '', description: descMatch?.[1] || '' };
        }
      }
    } catch {}
    return null;
  }

  getHashFromXml(xml: string): string | null {
    return extractHashFromXml(xml);
  }

  private resolveIssueDateTime(fechaEmision: string): { issueDate: string; issueTime: string } {
    const dateMatch = fechaEmision.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}))?/);
    if (dateMatch) {
      return {
        issueDate: dateMatch[1],
        issueTime: dateMatch[2] || '00:00:00',
      };
    }

    const d = new Date(fechaEmision);
    return {
      issueDate: d.toISOString().split('T')[0],
      issueTime: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`,
    };
  }
}
