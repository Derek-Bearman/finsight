'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  listMembers,
  inviteMember,
  changeMemberRole,
  removeMember,
  type FirmMember,
} from '@/lib/data/team';

type Role = 'owner' | 'admin' | 'member';

export function TeamManager({
  firmId,
  currentRole,
  currentUserId,
  initialMembers,
}: {
  firmId: string;
  currentRole: Role;
  currentUserId: string;
  initialMembers: FirmMember[];
}) {
  const [members, setMembers] = useState<FirmMember[]>(initialMembers);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canManage = currentRole === 'owner' || currentRole === 'admin';

  async function refresh() {
    const res = await listMembers(firmId);
    if (res.ok) setMembers(res.data);
  }

  function handleInvite() {
    setError(null);
    setInviteLink(null);
    startTransition(async () => {
      const res = await inviteMember(firmId, email, inviteRole);
      if (!res.ok) return setError(res.error);
      setInviteLink(`${window.location.origin}/invite/${res.data.token}`);
      setEmail('');
      await refresh();
    });
  }

  function handleRole(m: FirmMember, role: Role) {
    setError(null);
    startTransition(async () => {
      const res = await changeMemberRole(m.membershipId, role);
      if (!res.ok) return setError(res.error);
      await refresh();
    });
  }

  function handleRemove(m: FirmMember) {
    setError(null);
    startTransition(async () => {
      const res = await removeMember(m.membershipId);
      if (!res.ok) return setError(res.error);
      await refresh();
    });
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@firm.com"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Invitee email"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="rounded-md border border-border bg-background px-2 text-sm"
                aria-label="Invite role"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {currentRole === 'owner' && <option value="owner">Owner</option>}
              </select>
              <Button onClick={handleInvite} disabled={pending}>
                Send invite
              </Button>
            </div>
            {inviteLink && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                <p className="mb-1 font-medium">Invite link (send this until email is configured):</p>
                <code className="break-all">{inviteLink}</code>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            return (
              <div
                key={m.membershipId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span>{m.email}</span>
                  {isSelf && <Badge variant="secondary">You</Badge>}
                  {m.status !== 'active' && <Badge variant="outline">{m.status}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {canManage && !isSelf ? (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => handleRole(m, e.target.value as Role)}
                        disabled={pending}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        aria-label={`Role for ${m.email}`}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => handleRemove(m)}
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Badge variant={m.role === 'owner' ? 'default' : 'outline'}>{m.role}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
