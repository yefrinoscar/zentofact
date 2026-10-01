import { pool } from '../db';
import { SunatService } from './sunat.service';
import { classifyStatusCdr, seriesProbeVerdict } from './sunat-reconciliation';
import type { SeriesProbeVerdict, StatusCdrOutcome } from './sunat-reconciliation';

// Protección de la numeración cuando otro sistema emite con la misma serie
// (por ejemplo, un proveedor anterior que sigue usando B001). La numeración la
// define el RUC: un número ocupado en SUNAT nunca puede usarse otra vez.

export { seriesProbeVerdict };
export type { SeriesProbeVerdict };

const OCCUPIED_KINDS: Array<StatusCdrOutcome['kind']> = ['ACCEPTED', 'REJECTED', 'VOIDED'];
const DOCUMENT_TABLE = { '01': 'facturas', '03': 'boletas', '07': 'credit_notes' } as const;

type TipoDocumento = keyof typeof DOCUMENT_TABLE;

async function loadCompany(companyId: number) {
  const company = (await pool.query('select * from companies where id=$1', [companyId])).rows[0];
  if (!company) throw new Error('Empresa no encontrada');
  return company;
}

function sunatFor(company: any): SunatService {
  return new SunatService({
    ruc: company.ruc,
    razonSocial: company.razon_social,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuario_sol || 'MODDATOS',
    claveSol: company.clave_sol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificado_password || '',
  });
}

/** Último correlativo que ZentoFact usó en la serie, sumando todas las empresas con el mismo RUC. */
async function localMaxCorrelative(ruc: string, tipoDocumento: TipoDocumento, serie: string): Promise<number> {
  const result = await pool.query<{ max: string }>(
    `select greatest(
       coalesce((select max(co.correlativo_actual) from correlatives co
                   join branches b on b.id = co.branch_id
                   join companies c on c.id = b.company_id
                  where c.ruc = $1 and co.tipo_documento = $2 and co.serie = $3), 0),
       coalesce((select max(cast(d.correlativo as integer)) from ${DOCUMENT_TABLE[tipoDocumento]} d
                   join companies c on c.id = d.company_id
                  where c.ruc = $1 and d.serie = $3 and d.correlativo ~ '^[0-9]+$'), 0)
     )::text as max`,
    [ruc, tipoDocumento, serie],
  );
  return Number(result.rows[0]?.max || 0);
}

async function queryNumber(sunat: SunatService, ruc: string, tipoDocumento: TipoDocumento, serie: string, correlativo: number) {
  const numero = String(correlativo).padStart(6, '0');
  return { numero: `${serie}-${numero}`, outcome: classifyStatusCdr(await sunat.getStatusCdr(ruc, tipoDocumento, serie, numero)) };
}

export interface SeriesProbe {
  serie: string;
  tipoDocumento: string;
  localMax: number;
  checked: Array<{ numero: string; kind: StatusCdrOutcome['kind'] }>;
  verdict: SeriesProbeVerdict;
}

/** Consulta en SUNAT los próximos números que ZentoFact todavía no usó. */
export async function probeSeriesCollision(params: { companyId: number; tipoDocumento: TipoDocumento; serie: string; lookahead?: number }): Promise<SeriesProbe> {
  const company = await loadCompany(params.companyId);
  const sunat = sunatFor(company);
  const localMax = await localMaxCorrelative(company.ruc, params.tipoDocumento, params.serie);
  const checked: SeriesProbe['checked'] = [];
  const outcomes: StatusCdrOutcome[] = [];
  for (let offset = 1; offset <= (params.lookahead ?? 2); offset += 1) {
    const { numero, outcome } = await queryNumber(sunat, company.ruc, params.tipoDocumento, params.serie, localMax + offset);
    outcomes.push(outcome);
    checked.push({ numero, kind: outcome.kind });
  }
  return { serie: params.serie, tipoDocumento: params.tipoDocumento, localMax, checked, verdict: seriesProbeVerdict(outcomes) };
}

export interface SeriesAdvance {
  serie: string;
  from: number;
  to: number;
  advanced: boolean;
  /** false si SUNAT no respondió: no se sabe cuál es el siguiente número libre. */
  conclusive: boolean;
  occupied: string[];
}

/**
 * Contingencia ante otro emisor en la misma serie: recorre en SUNAT los números
 * siguientes al último local hasta encontrar dos libres seguidos y deja el
 * correlativo después del último ocupado. Así el próximo número que reserve
 * ZentoFact está libre. Nunca retrocede el correlativo.
 */
export async function advancePastExternalNumbers(params: {
  companyId: number;
  tipoDocumento: TipoDocumento;
  serie: string;
  maxProbe?: number;
}): Promise<SeriesAdvance> {
  const company = await loadCompany(params.companyId);
  const sunat = sunatFor(company);
  const from = await localMaxCorrelative(company.ruc, params.tipoDocumento, params.serie);
  const occupied: string[] = [];
  let highest = from;
  let freeInARow = 0;
  let conclusive = true;
  for (let correlativo = from + 1; correlativo <= from + (params.maxProbe ?? 30) && freeInARow < 2; correlativo += 1) {
    const { numero, outcome } = await queryNumber(sunat, company.ruc, params.tipoDocumento, params.serie, correlativo);
    if (OCCUPIED_KINDS.includes(outcome.kind)) {
      occupied.push(numero);
      highest = correlativo;
      freeInARow = 0;
    } else if (outcome.kind === 'NOT_FOUND') {
      freeInARow += 1;
    } else {
      conclusive = false;
      break;
    }
  }
  if (freeInARow < 2) conclusive = false;

  if (highest > from) {
    const branches = (await pool.query<{ id: number }>(
      `select b.id from branches b join companies c on c.id = b.company_id where c.ruc = $1 order by b.id`,
      [company.ruc],
    )).rows;
    const updated = await pool.query(
      `update correlatives set correlativo_actual = greatest(coalesce(correlativo_actual, 0), $1), updated_at = $2
        where branch_id = any($3::int[]) and tipo_documento = $4 and serie = $5`,
      [highest, Math.floor(Date.now() / 1000), branches.map((branch) => branch.id), params.tipoDocumento, params.serie],
    );
    if (!updated.rowCount && branches[0]) {
      const now = Math.floor(Date.now() / 1000);
      await pool.query(
        `insert into correlatives (branch_id, tipo_documento, serie, correlativo_actual, activo, created_at, updated_at)
         values ($1, $2, $3, $4, true, $5, $5)`,
        [branches[0].id, params.tipoDocumento, params.serie, highest, now],
      );
    }
  }
  return { serie: params.serie, from, to: highest, advanced: highest > from, conclusive, occupied };
}
