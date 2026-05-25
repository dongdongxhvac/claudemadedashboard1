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

export type OncallProposalPayload = {
  settings: {
    start_friday: string;
    rotations_per_engineer: number;
  };
  participants: OncallProposalParticipant[];
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
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
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
