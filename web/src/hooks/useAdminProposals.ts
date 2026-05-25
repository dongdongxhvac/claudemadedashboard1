// Admin tab draft → review → publish workflow.
//
// One shared `admin_proposals` table backs every Admin tab. Each row carries
// a `tab` discriminator ('oncall' | 'buildings' | 'rounds') and a JSON payload
// shaped by the tab. Only ONE pending proposal per tab exists at a time
// (enforced by partial unique index in migration 0031).
//
// State machine:
//   pending → published   (manager only, via publish_*_proposal RPCs)
//   pending → rejected    (manager only, via reject_proposal RPC)
//   pending → withdrawn   (original proposer only, via withdraw_proposal RPC)
//
// Phase A: on-call only. Buildings/Rounds reuse this scaffolding when wired.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type ProposalStatus = 'pending' | 'published' | 'rejected' | 'withdrawn';
export type ProposalTab = 'oncall' | 'buildings' | 'rounds';

export type OncallProposalParticipant = {
  user_id: string;
  effective_from: string | null;
};

export type OncallProposalNote = {
  slot: number;
  body: string;
};

export type OncallProposalPayload = {
  settings: {
    start_friday: string;
    rotations_per_engineer: number;
  };
  participants: OncallProposalParticipant[];
  /** Optional — proposals from Phase 9.0 won't include this field. */
  notes?: OncallProposalNote[];
};

// Buildings ===================================================================

export type BuildingsProposalAssignment = {
  building_id: string;
  user_id: string;
  role_in_building: 'primary' | 'backup';
};

export type BuildingsProposalNote = { slot: number; body: string };

export type BuildingsProposalPayload = {
  assignments: BuildingsProposalAssignment[];
  notes?: BuildingsProposalNote[];
};

export type PendingProposal<TPayload = unknown> = {
  id: string;
  tab: ProposalTab;
  payload: TPayload;
  note: string | null;
  status: ProposalStatus;
  proposed_by_user_id: string;
  proposed_by_name: string;
  proposed_at: string;
};

const KEY_PENDING = (tab: ProposalTab) => ['admin_proposal_pending', tab];
const KEY_HISTORY = (tab: ProposalTab, limit: number) => ['admin_proposal_history', tab, limit];

export type PublishedProposal<TPayload = unknown> = {
  id: string;
  tab: ProposalTab;
  payload: TPayload;
  note: string | null;
  proposed_by_user_id: string;
  proposed_by_name: string;
  proposed_at: string;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
};

/** Fetch the single pending proposal for a tab (or null), with proposer name joined. */
export function usePendingProposal<TPayload = unknown>(tab: ProposalTab) {
  return useQuery({
    queryKey: KEY_PENDING(tab),
    queryFn: async (): Promise<PendingProposal<TPayload> | null> => {
      const { data, error } = await supabase
        .from('admin_proposals')
        .select(`
          id, tab, payload, note, status,
          proposed_by_user_id, proposed_at,
          users!admin_proposals_proposed_by_user_id_fkey(full_name)
        `)
        .eq('tab', tab)
        .eq('status', 'pending')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      type Joined = {
        id: string;
        tab: ProposalTab;
        payload: TPayload;
        note: string | null;
        status: ProposalStatus;
        proposed_by_user_id: string;
        proposed_at: string;
        users: { full_name: string } | { full_name: string }[] | null;
      };
      const row = data as unknown as Joined;
      const u = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        id: row.id,
        tab: row.tab,
        payload: row.payload,
        note: row.note,
        status: row.status,
        proposed_by_user_id: row.proposed_by_user_id,
        proposed_by_name: u?.full_name ?? 'Unknown',
        proposed_at: row.proposed_at,
      };
    },
    staleTime: 30_000,
  });
}

/** Realtime: any change to admin_proposals invalidates the per-tab cache. */
export function useAdminProposalsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('admin-proposals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_proposals' }, () => {
        qc.invalidateQueries({ queryKey: ['admin_proposal_pending', 'oncall'] });
        qc.invalidateQueries({ queryKey: ['admin_proposal_pending', 'buildings'] });
        qc.invalidateQueries({ queryKey: ['admin_proposal_pending', 'rounds'] });
        qc.invalidateQueries({ queryKey: ['admin_proposal_history', 'oncall'] });
        qc.invalidateQueries({ queryKey: ['admin_proposal_history', 'buildings'] });
        qc.invalidateQueries({ queryKey: ['admin_proposal_history', 'rounds'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

/** Fetch published proposals for a tab, newest first. Used for the
 *  "Schedule history" section so the team can see who changed what when. */
export function usePublishedProposalHistory<TPayload = unknown>(
  tab: ProposalTab,
  limit: number = 20,
) {
  return useQuery({
    queryKey: KEY_HISTORY(tab, limit),
    queryFn: async (): Promise<PublishedProposal<TPayload>[]> => {
      const { data, error } = await supabase
        .from('admin_proposals')
        .select(`
          id, tab, payload, note,
          proposed_by_user_id, proposed_at,
          reviewed_by_user_id, reviewed_at,
          proposer:users!admin_proposals_proposed_by_user_id_fkey(full_name),
          reviewer:users!admin_proposals_reviewed_by_user_id_fkey(full_name)
        `)
        .eq('tab', tab)
        .eq('status', 'published')
        .order('reviewed_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      type Joined = {
        id: string;
        tab: ProposalTab;
        payload: TPayload;
        note: string | null;
        proposed_by_user_id: string;
        proposed_at: string;
        reviewed_by_user_id: string | null;
        reviewed_at: string | null;
        proposer: { full_name: string } | { full_name: string }[] | null;
        reviewer: { full_name: string } | { full_name: string }[] | null;
      };
      return (data as unknown as Joined[]).map((r) => {
        const p = Array.isArray(r.proposer) ? r.proposer[0] : r.proposer;
        const v = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
        return {
          id: r.id,
          tab: r.tab,
          payload: r.payload,
          note: r.note,
          proposed_by_user_id: r.proposed_by_user_id,
          proposed_by_name: p?.full_name ?? 'Unknown',
          proposed_at: r.proposed_at,
          reviewed_by_user_id: r.reviewed_by_user_id,
          reviewed_by_name: v?.full_name ?? null,
          reviewed_at: r.reviewed_at,
        };
      });
    },
    staleTime: 60_000,
  });
}

/** Submit an on-call proposal. Fails if one is already pending (partial unique idx). */
export function useProposeOncall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payload: OncallProposalPayload; note?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Not signed in');
      const { data: me, error: meErr } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) throw new Error('Your account is not linked to a users row');

      const { error } = await supabase.from('admin_proposals').insert({
        tab: 'oncall',
        payload: input.payload,
        note: input.note ?? null,
        proposed_by_user_id: (me as { id: string }).id,
        status: 'pending',
      });
      if (error) {
        if (error.code === '23505') {
          throw new Error('Another draft for On-call is already pending review.');
        }
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PENDING('oncall') }),
  });
}

/** Submit a buildings proposal. Fails if one is already pending. */
export function useProposeBuildings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payload: BuildingsProposalPayload; note?: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Not signed in');
      const { data: me, error: meErr } = await supabase
        .from('users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
      if (meErr) throw meErr;
      if (!me) throw new Error('Your account is not linked to a users row');

      const { error } = await supabase.from('admin_proposals').insert({
        tab: 'buildings',
        payload: input.payload,
        note: input.note ?? null,
        proposed_by_user_id: (me as { id: string }).id,
        status: 'pending',
      });
      if (error) {
        if (error.code === '23505') {
          throw new Error('Another draft for Buildings is already pending review.');
        }
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PENDING('buildings') }),
  });
}

/** Manager-only: publish a buildings proposal. */
export function usePublishBuildingsProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.rpc('publish_buildings_proposal', {
        p_proposal_id: proposalId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_PENDING('buildings') });
      qc.invalidateQueries({ queryKey: ['building_assignments'] });
      qc.invalidateQueries({ queryKey: ['buildings_notes'] });
      qc.invalidateQueries({ queryKey: ['admin_proposal_history', 'buildings'] });
    },
  });
}

/** Manager-only: publish an on-call proposal. Applies payload + marks status. */
export function usePublishOncallProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.rpc('publish_oncall_proposal', {
        p_proposal_id: proposalId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_PENDING('oncall') });
      qc.invalidateQueries({ queryKey: ['oncall_current'] });
      qc.invalidateQueries({ queryKey: ['oncall_upcoming'] });
      qc.invalidateQueries({ queryKey: ['oncall_participants'] });
      qc.invalidateQueries({ queryKey: ['oncall_settings'] });
      qc.invalidateQueries({ queryKey: ['oncall_notes'] });
      qc.invalidateQueries({ queryKey: ['admin_proposal_history', 'oncall'] });
    },
  });
}

/** Manager-only: reject a proposal with an optional note. */
export function useRejectProposal(tab: ProposalTab) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposalId: string; note?: string | null }) => {
      const { error } = await supabase.rpc('reject_proposal', {
        p_proposal_id: input.proposalId,
        p_note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PENDING(tab) }),
  });
}

/** Original-proposer-only: withdraw your own pending proposal. */
export function useWithdrawProposal(tab: ProposalTab) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.rpc('withdraw_proposal', {
        p_proposal_id: proposalId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PENDING(tab) }),
  });
}
