// 8-Week Tracker board data (migration 0152 training_board) for the admin
// Tracker drawer's Training section. The board definition comes from the
// print station's `tracker` document (hooks/useTrainingDocs.ts), the program
// start date from new_hire_enrollments (hooks/useNewHire.ts), quiz passes
// from new_hire_doc_activity — all merged by lib/trainingBoard.ts.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';
import { useTrainingDocs } from './useTrainingDocs';
import { useNewHireUser, useEnrollNewHire } from './useNewHire';
import { DEFAULT_PROGRAM } from '../lib/programs';
import { nhWeekFor } from '../lib/newHireProgram';
import {
  parseTrainingBoard, boardProgress, weekOfDate,
  type BoardRow, type TrainingBoardDef, type QuizPass, type BoardProgress,
} from '../lib/trainingBoard';

const KEY = ['training_board'];
export const BOARD_DOC_KEY = 'tracker';

export function useTrainingBoardRows(userId: string | undefined, programKey = DEFAULT_PROGRAM.key) {
  return useQuery({
    queryKey: [...KEY, userId, programKey],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error } = await supabase
        .from('training_board').select('*')
        .eq('user_id', userId!).eq('program_key', programKey)
        .order('week', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BoardRow[];
    },
  });
}

/** The board definition parsed from the print station (null while loading / missing). */
export function useTrainingBoardDef() {
  const docs = useTrainingDocs();
  const doc = docs.byKey.get(BOARD_DOC_KEY) ?? null;
  const def = useMemo<TrainingBoardDef | null>(() => {
    if (!doc) return null;
    try { return parseTrainingBoard(doc.html); } catch { return null; }
  }, [doc]);
  return { def, doc, isLoading: docs.isLoading, error: docs.isError ? (docs.error as Error) : (!docs.isLoading && !doc ? new Error('The print station has no "8-Week Tracker" document') : null), printStationUrl: docs.printStationUrl };
}

export function useTrainingBoard(userId: string | undefined) {
  const program = DEFAULT_PROGRAM;
  const rowsQ = useTrainingBoardRows(userId, program.key);
  const { def, doc, isLoading: defLoading, error: defError, printStationUrl } = useTrainingBoardDef();
  const nh = useNewHireUser(userId ?? '', program);
  const startDate = nh.state.enrollment?.start_date ?? null;
  const currentWeek = nhWeekFor(startDate);
  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const quizzes = useMemo<QuizPass[]>(() => nh.state.activity
    .filter((a) => a.kind === 'quiz' && a.score != null && a.total && a.score / a.total >= 0.8)
    .map((a) => ({ week: weekOfDate(a.at, startDate), title: a.quiz_title || a.doc_key, score: a.score!, total: a.total! })), [nh.state.activity, startDate]);
  const progress = useMemo<BoardProgress | null>(() => (def ? boardProgress(def, rows) : null), [def, rows]);
  return {
    def, doc, rows, startDate, currentWeek, quizzes, progress, printStationUrl,
    enrollment: nh.state.enrollment,
    isLoading: rowsQ.isLoading || defLoading || nh.isLoading,
    error: (rowsQ.error as Error | null) ?? defError ?? null,
  };
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export type BoardRowInput = Pick<BoardRow, 'item_key' | 'week' | 'status' | 'note' | 'value'>;

/** Save a batch: upsert rows that carry something, delete rows that are empty. */
export function useSaveTrainingBoard() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { user_id: string; program_key?: string; rows: BoardRowInput[] }) => {
      const program_key = input.program_key ?? DEFAULT_PROGRAM.key;
      const keep = input.rows.filter((r) => r.status || (r.note && r.note.trim()) || Object.keys(r.value ?? {}).length);
      const drop = input.rows.filter((r) => !keep.includes(r));
      if (keep.length) {
        const { data, error } = await supabase
          .from('training_board')
          .upsert(keep.map((r) => ({
            user_id: input.user_id, program_key, item_key: r.item_key, week: r.week,
            status: r.status, note: r.note?.trim() || null, value: r.value ?? {}, updated_by: me?.id ?? null,
          })), { onConflict: 'user_id,program_key,item_key,week' })
          .select('item_key');
        if (error) throw error;
        if ((data?.length ?? 0) < keep.length) throw new Error('Not permitted to edit this board.');
      }
      for (const r of drop) {
        const { error } = await supabase.from('training_board').delete()
          .eq('user_id', input.user_id).eq('program_key', program_key).eq('item_key', r.item_key).eq('week', r.week);
        if (error) throw error;
      }
    },
    onSuccess: inv,
  });
}

/** Start date lives on the enrollment (new_hire_enrollments) — the week chips follow it. */
export function useSetTrainingStart() {
  const enroll = useEnrollNewHire();
  return useMutation({
    mutationFn: async (input: { user_id: string; start_date: string | null; mentor_user_id?: string | null }) =>
      enroll.mutateAsync({ user_id: input.user_id, program_key: DEFAULT_PROGRAM.key, start_date: input.start_date, mentor_user_id: input.mentor_user_id ?? null }),
  });
}

/** Roster: everyone's board progress in one fetch (RLS-trimmed). */
export function useAllTrainingBoardProgress() {
  const { def } = useTrainingBoardDef();
  const q = useQuery({
    queryKey: [...KEY, 'all'],
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, BoardRow[]>> => {
      const { data, error } = await supabase.from('training_board').select('*').eq('program_key', DEFAULT_PROGRAM.key);
      if (error) throw error;
      const m = new Map<string, BoardRow[]>();
      for (const r of (data ?? []) as BoardRow[]) {
        const arr = m.get(r.user_id) ?? [];
        arr.push(r);
        m.set(r.user_id, arr);
      }
      return m;
    },
  });
  const byUser = useMemo(() => {
    const m = new Map<string, BoardProgress>();
    if (!def || !q.data) return m;
    for (const [uid, rows] of q.data) m.set(uid, boardProgress(def, rows));
    return m;
  }, [def, q.data]);
  return { ...q, byUser, total: def?.total ?? 0 };
}
