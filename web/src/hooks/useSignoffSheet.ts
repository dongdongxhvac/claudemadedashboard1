// The parsed Master Sign-Off Sheet (lib/signoffSheet.ts) from the Print
// Station — the program definition every progress number is computed from.
import { useMemo } from 'react';
import { useTrainingDocs } from './useTrainingDocs';
import { parseSignoffSheet, type SignoffSheet } from '../lib/signoffSheet';

export function useSignoffSheet(): { sheet: SignoffSheet | null; scheduleHtml: string | null; isLoading: boolean; error: Error | null } {
  const docs = useTrainingDocs();
  const sheetDoc = docs.byKey.get('signoff_sheet');
  const scheduleDoc = docs.byKey.get('plan');
  const parsed = useMemo(() => {
    if (!sheetDoc) return { sheet: null, error: null as Error | null };
    try { return { sheet: parseSignoffSheet(sheetDoc.html), error: null as Error | null }; }
    catch (e) { return { sheet: null, error: e as Error }; }
  }, [sheetDoc]);
  const error = docs.isError ? (docs.error as Error)
    : parsed.error ? parsed.error
    : (!docs.isLoading && !sheetDoc) ? new Error('The print station has no "Master Sign-Off Sheet" document')
    : null;
  return { sheet: parsed.sheet, scheduleHtml: scheduleDoc?.html ?? null, isLoading: docs.isLoading, error };
}
