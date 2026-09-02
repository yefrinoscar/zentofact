const CREDIT_NOTE_SEND_LIMIT_DAYS = 3;
const CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS = 2;

declare const creditNoteIssueDateBrand: unique symbol;

export type CreditNoteIssueDate = string & {
  readonly [creditNoteIssueDateBrand]: 'CreditNoteIssueDate';
};

export type CreditNoteIssueDatePolicy = {
  today: CreditNoteIssueDate;
  sendWindowStart: CreditNoteIssueDate;
  currentMonthStart: CreditNoteIssueDate;
  previousMonthEnd: CreditNoteIssueDate;
  earliestDate: CreditNoteIssueDate;
  defaultDate: CreditNoteIssueDate;
  latestAffectedDocumentDate?: CreditNoteIssueDate;
  canUsePreviousMonthEnd: boolean;
};

export type CreditNoteIssueDateContext = {
  today?: string;
  affectedDocumentDates?: readonly unknown[];
};

export function creditNoteIssueDatePolicy(
  context: CreditNoteIssueDateContext = {},
): CreditNoteIssueDatePolicy {
  const current = parseDateKey(context.today ?? todayInLima(), 'La fecha actual del sistema no es válida.');
  const sendWindowStart = addDays(current, -CREDIT_NOTE_SEND_LIMIT_DAYS);
  const currentMonthStart = `${current.slice(0, 7)}-01` as CreditNoteIssueDate;
  const previousMonthEnd = addDays(currentMonthStart, -1);
  const affectedDocumentDates = parseDates(
    context.affectedDocumentDates ?? [],
    'La fecha del comprobante afectado no es válida.',
  );
  const latestAffectedDocumentDate = latestDate(affectedDocumentDates);
  if (latestAffectedDocumentDate && latestAffectedDocumentDate > current) {
    throw new Error('La fecha del comprobante afectado no puede ser futura.');
  }

  const dayOfMonth = Number(current.slice(8, 10));
  const previousMonthDocumentStart = addDays(
    previousMonthEnd,
    1 - CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS,
  );
  const canUsePreviousMonthEnd = dayOfMonth <= CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS
    && affectedDocumentDates.length > 0
    && affectedDocumentDates.every(
      (date) => date >= previousMonthDocumentStart && date <= previousMonthEnd,
    );
  const currentMonthEarliestDate = maxDate(
    currentMonthStart,
    sendWindowStart,
    latestAffectedDocumentDate,
  );
  const earliestDate = canUsePreviousMonthEnd ? previousMonthEnd : currentMonthEarliestDate;
  const defaultDate = canUsePreviousMonthEnd ? previousMonthEnd : current;

  return {
    today: current,
    sendWindowStart,
    currentMonthStart,
    previousMonthEnd,
    earliestDate,
    defaultDate,
    latestAffectedDocumentDate,
    canUsePreviousMonthEnd,
  };
}

export function resolveCreditNoteIssueDate(
  requestedDate: unknown,
  context: CreditNoteIssueDateContext = {},
): CreditNoteIssueDate {
  const policy = creditNoteIssueDatePolicy(context);
  if (requestedDate === undefined || requestedDate === null || requestedDate === '') {
    return policy.defaultDate;
  }

  const issueDate = parseDateKey(requestedDate, 'La fecha de emisión debe tener el formato AAAA-MM-DD.');
  if (issueDate > policy.today) {
    throw new Error('La fecha de emisión no puede ser futura.');
  }
  if (policy.latestAffectedDocumentDate && issueDate < policy.latestAffectedDocumentDate) {
    throw new Error(
      `La fecha de emisión no puede ser anterior al comprobante afectado (${policy.latestAffectedDocumentDate}).`,
    );
  }
  if (issueDate < policy.currentMonthStart) {
    const dayOfMonth = Number(policy.today.slice(8, 10));
    if (dayOfMonth > CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS) {
      throw new Error(
        'La fecha del mes anterior solo puede usarse durante los primeros 2 días del mes actual.',
      );
    }
    if (issueDate !== policy.previousMonthEnd) {
      throw new Error(
        `Para registrar la nota en el mes anterior solo puedes usar ${formatDayMonth(policy.previousMonthEnd)}.`,
      );
    }
    if (!policy.canUsePreviousMonthEnd) {
      const allowedDocumentStart = addDays(
        policy.previousMonthEnd,
        1 - CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS,
      );
      const allowedDates = allowedDocumentStart === policy.previousMonthEnd
        ? formatDayMonth(policy.previousMonthEnd)
        : `${formatDayMonth(allowedDocumentStart)} o ${formatDayMonth(policy.previousMonthEnd)}`;
      throw new Error(
        `Para fechar la nota el ${formatDayMonth(policy.previousMonthEnd)}, todos los comprobantes afectados deben ser del ${allowedDates}.`,
      );
    }
  }
  if (issueDate < policy.sendWindowStart) {
    throw new Error(
      `SUNAT permite enviar la nota hasta 3 días calendario después de su fecha de emisión. Elige una fecha entre ${policy.sendWindowStart} y ${policy.today}.`,
    );
  }

  return issueDate;
}

export function resolveCreditNoteBatchIssueDate(
  requestedDate: unknown,
  context: CreditNoteIssueDateContext,
): CreditNoteIssueDate {
  return resolveCreditNoteIssueDate(requestedDate, context);
}

export function validateCreditNoteIssueDateForSend(
  issueDate: unknown,
  context: CreditNoteIssueDateContext = {},
): CreditNoteIssueDate {
  if (issueDate === undefined || issueDate === null || issueDate === '') {
    throw new Error('La nota de crédito no tiene una fecha de emisión válida.');
  }
  return resolveCreditNoteIssueDate(issueDate, context);
}

function todayInLima(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDateKey(value: unknown, errorMessage: string): CreditNoteIssueDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(errorMessage);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(errorMessage);
  }

  return value as CreditNoteIssueDate;
}

function addDays(value: string, days: number): CreditNoteIssueDate {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10) as CreditNoteIssueDate;
}

function parseDates(values: readonly unknown[], errorMessage: string): CreditNoteIssueDate[] {
  return values.map((value) => parseDateKey(value, errorMessage));
}

function latestDate(values: readonly CreditNoteIssueDate[]): CreditNoteIssueDate | undefined {
  let latest: CreditNoteIssueDate | undefined;
  for (const value of values) {
    if (!latest || value > latest) latest = value;
  }
  return latest;
}

function maxDate(
  first: CreditNoteIssueDate,
  second: CreditNoteIssueDate,
  third?: CreditNoteIssueDate,
): CreditNoteIssueDate {
  let latest = first > second ? first : second;
  if (third && third > latest) latest = third;
  return latest;
}

function formatDayMonth(value: CreditNoteIssueDate): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
}
