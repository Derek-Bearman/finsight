'use server';

/**
 * Team + invitation server actions. Thin, typed wrappers over the Phase-3
 * SECURITY DEFINER RPCs (which enforce role-cap / >=1-owner / no-self-promote /
 * verified-email accept). Called from client team-management UI. Every call
 * runs through the request-scoped server client, so the RPC sees the caller's
 * auth.uid() and re-derives authorization; these actions add no privilege.
 *
 * All return a discriminated result so the UI can show the RPC's own message
 * (e.g. "only an owner may invite role owner") instead of a thrown error page.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Enums } from '@/lib/supabase/database.types';

type Role = Enums<'membership_role'>;
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface FirmMember {
  membershipId: string;
  userId: string;
  email: string;
  role: Role;
  status: Enums<'membership_status'>;
  createdAt: string;
}

export async function listMembers(firmId: string): Promise<ActionResult<FirmMember[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('list_firm_members', { p_firm_id: firmId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((m) => ({
      membershipId: m.membership_id,
      userId: m.user_id,
      email: m.email,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
    })),
  };
}

/** Invite an email to the firm. Returns the plaintext invite token so the
 *  caller can build the accept link `${origin}/invite/${token}` to email. */
export async function inviteMember(
  firmId: string,
  email: string,
  role: Role
): Promise<ActionResult<{ token: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_invitation', {
    p_firm_id: firmId,
    p_email: email,
    p_role: role,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { token: data as string } };
}

export async function acceptInvite(token: string): Promise<ActionResult<{ firmId: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { firmId: data as string } };
}

export async function revokeInvite(invitationId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function changeMemberRole(
  membershipId: string,
  newRole: Role
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_membership_role', {
    p_membership_id: membershipId,
    p_new_role: newRole,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function removeMember(membershipId: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('remove_membership', { p_membership_id: membershipId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
