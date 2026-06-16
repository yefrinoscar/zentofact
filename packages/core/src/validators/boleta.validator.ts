import { z } from 'zod';

const clientSchema = z.object({
  tipo_documento: z.enum(['1', '4', '6', '7', '0']),
  numero_documento: z.string().max(15),
  razon_social: z.string().max(255),
  nombre_comercial: z.string().max(255).optional(),
  direccion: z.string().max(255).optional(),
  ubigeo: z.string().max(6).optional(),
  distrito: z.string().max(100).optional(),
  provincia: z.string().max(100).optional(),
  departamento: z.string().max(100).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
});

const detalleSchema = z.object({
  codigo: z.string().max(30),
  descripcion: z.string().max(255),
  unidad: z.string().max(3),
  cantidad: z.number().min(0.01),
  mto_valor_unitario: z.number().min(0),
  mto_valor_gratuito: z.number().min(0).optional(),
  porcentaje_igv: z.number().min(0).max(100),
  porcentaje_ivap: z.number().min(0).max(100).optional(),
  tip_afe_igv: z.enum([
    '10','11','12','13','14','15','16','17',
    '20','21',
    '30','31','32','33','34','35','36','37','40',
  ]),
  isc: z.number().min(0).optional(),
  icbper: z.number().min(0).optional(),
  factor_icbper: z.number().min(0).optional(),
  codigo_producto_sunat: z.string().optional(),
});

const leyendaSchema = z.object({
  code: z.string().max(4),
  value: z.string().max(255),
});

export const createBoletaSchema = z.object({
  company_id: z.number().int().positive(),
  branch_id: z.number().int().positive(),
  serie: z.string().max(4),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ubl_version: z.string().max(5).optional().default('2.1'),
  tipo_operacion: z.string().max(4).optional().default('0101'),
  moneda: z.string().max(3).optional().default('PEN'),
  metodo_envio: z.enum(['individual', 'resumen_diario']),
  forma_pago_tipo: z.string().max(20).optional(),
  client: clientSchema,
  detalles: z.array(detalleSchema).min(1),
  leyendas: z.array(leyendaSchema).optional(),
  datos_adicionales: z.array(z.any()).optional(),
  usuario_creacion: z.string().max(100).optional(),
});

export const indexBoletaSchema = z.object({
  company_id: z.string().optional(),
  branch_id: z.string().optional(),
  estado_sunat: z.enum(['PENDIENTE', 'PROCESANDO', 'ACEPTADO', 'RECHAZADO', 'ANULADO']).optional(),
  fecha_desde: z.string().optional(),
  fecha_hasta: z.string().optional(),
  per_page: z.string().optional().default('15'),
});

export const createDailySummarySchema = z.object({
  company_id: z.number().int().positive(),
  branch_id: z.number().int().positive(),
  fecha_resumen: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usuario_creacion: z.string().max(100).optional(),
});

export const generatePdfSchema = z.object({
  format: z.enum(['A4', 'A5', '80mm', '50mm', 'ticket']).optional().default('A4'),
});

export const pendingSummarySchema = z.object({
  company_id: z.string(),
  branch_id: z.string(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const initializeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
