import { addDaysToDateKey, todayInLima } from './documentDateRange.ts';

const CREDIT_NOTE_SEND_LIMIT_DAYS = 3;
const CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS = 2;

export type CreditNoteIssueDatePolicy = {
  today: string;
  sendWindowStart: string;
  currentMonthStart: string;
  previousMonthEnd: string;
  earliestDate: string;
  defaultDate: string;
  latestAffectedDocumentDate?: string;
  canUsePreviousMonthEnd: boolean;
};

export type CreditNoteIssueDateContext = {
  today?: string;
  affectedDocumentDates?: readonly (string | null | undefined)[];
};

export function creditNoteIssueDatePolicy(
  context: CreditNoteIssueDateContext = {},
): CreditNoteIssueDatePolicy {
  const today = context.today ?? todayInLima();
  const dayOfMonth = Number(today.slice(8, 10));
  const sendWindowStart = addDaysToDateKey(today, -CREDIT_NOTE_SEND_LIMIT_DAYS);
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = addDaysToDateKey(currentMonthStart, -1);
  const affectedDocumentDates = (context.affectedDocumentDates ?? [])
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .sort();
  const latestAffectedDocumentDate = affectedDocumentDates.at(-1);
  const previousMonthDocumentStart = addDaysToDateKey(
    previousMonthEnd,
    1 - CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS,
  );
  const canUsePreviousMonthEnd = dayOfMonth <= CREDIT_NOTE_PREVIOUS_MONTH_LIMIT_DAYS
    && affectedDocumentDates.length > 0
    && affectedDocumentDates.every(
      (date) => date >= previousMonthDocumentStart && date <= previousMonthEnd,
    );
  const currentMonthEarliestDate = [
    currentMonthStart,
    sendWindowStart,
    latestAffectedDocumentDate,
  ].filter((value): value is string => Boolean(value)).sort().at(-1) ?? currentMonthStart;
  const earliestDate = canUsePreviousMonthEnd ? previousMonthEnd : currentMonthEarliestDate;

  return {
    today,
    sendWindowStart,
    currentMonthStart,
    previousMonthEnd,
    earliestDate,
    defaultDate: canUsePreviousMonthEnd ? previousMonthEnd : today,
    latestAffectedDocumentDate,
    canUsePreviousMonthEnd,
  };
}

export function constrainCreditNoteIssueDate(value: string, policy: CreditNoteIssueDatePolicy): string {
  return value < policy.earliestDate || value > policy.today ? policy.defaultDate : value;
}
