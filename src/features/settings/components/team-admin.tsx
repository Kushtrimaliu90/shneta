'use client';

import { useActionState, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  changeStaffRole,
  inviteStaff,
  setStaffActive,
  type SettingsErrorKey,
  type SettingsState,
} from '@/features/settings/actions';
import { ROLE_DESCRIPTIONS, SETTINGS_ERRORS } from '@/features/settings/copy';
import { roleLabel, STAFF_ROLES } from '@/features/admin/roles';
import type { TeamMember } from '@/features/settings/queries';
import { cn } from '@/lib/utils';

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

function feedback(state: SettingsState): { tone: 'success' | 'error'; text: string } | null {
  if (!state) return null;
  if (state.ok) return { tone: 'success', text: state.data.message ?? 'Done.' };
  const field = Object.values(state.fieldErrors ?? {})[0]?.[0];
  return { tone: 'error', text: field ?? SETTINGS_ERRORS[state.error as SettingsErrorKey] };
}

/** docs/06 §15 — the staff list, invite, role change and deactivate. */
export function TeamAdmin({ members, currentUserId }: { members: TeamMember[]; currentUserId: string }) {
  return (
    <div>
      <InviteForm />

      <ul className="mt-6 flex flex-col gap-2">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} isSelf={member.id === currentUserId} />
        ))}
      </ul>
    </div>
  );
}

function InviteForm() {
  const [state, action] = useActionState<SettingsState, FormData>(inviteStaff, null);
  const [open, setOpen] = useState(false);
  const result = feedback(state);

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Add someone
        </Button>
        {result && (
          <Alert tone={result.tone} className="mt-3">
            {result.text}
          </Alert>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="rounded-lg border border-line-strong bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email <span className="text-error">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Name
          </label>
          <input id="fullName" name="fullName" className={inputClass} />
        </div>
        <div>
          <label htmlFor="role" className={labelClass}>
            Role
          </label>
          <select id="role" name="role" defaultValue="support" className={inputClass}>
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-3 max-w-prose text-xs text-ink-600">
        {/*
          Said plainly because it is the part that surprises people: no invitation email is sent,
          and none can be until Resend is configured (docs/14 §6).
        */}
        No password is set and no email is sent. They sign in by using &ldquo;forgot
        password&rdquo; with this address — which needs email to be configured. Until then, set a
        password for them from the Supabase dashboard.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Creating…">
          Create account
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {result && (
        <Alert tone={result.tone} className="mt-3">
          {result.text}
        </Alert>
      )}
    </form>
  );
}

function MemberRow({ member, isSelf }: { member: TeamMember; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState<SettingsState, FormData>(changeStaffRole, null);
  const [activeState, activeAction] = useActionState<SettingsState, FormData>(setStaffActive, null);

  const result = feedback(roleState) ?? feedback(activeState);

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface p-4',
        member.deactivated ? 'border-line opacity-70' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-900">
            {member.fullName || member.email}
            {isSelf && <span className="ml-2 text-xs text-ink-500">(you)</span>}
            {member.deactivated && (
              <span className="ml-2 rounded-sm bg-ink-600 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
                Deactivated
              </span>
            )}
          </p>
          <p className="text-xs text-ink-500">{member.email}</p>
          <p className="mt-0.5 text-xs text-ink-600">
            {ROLE_DESCRIPTIONS[member.role] ?? member.role}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <form action={roleAction} className="flex items-end gap-2">
            <input type="hidden" name="userId" value={member.id} />
            <div>
              <label htmlFor={`role-${member.id}`} className="sr-only">
                Role for {member.email}
              </label>
              <select
                id={`role-${member.id}`}
                name="role"
                defaultValue={member.role}
                className="h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
              >
                {['customer', ...STAFF_ROLES].map((role) => (
                  <option key={role} value={role}>
                    {role === 'customer' ? 'No access' : roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton size="sm" variant="secondary" loadingLabel="…">
              Set role
            </SubmitButton>
          </form>

          {/*
            Deactivating yourself is possible and deliberately not blocked — an admin locking
            themselves out is prevented by the last-admin rule, and any other role doing it is
            just leaving. Blocking it would mean nobody can hand over their own account.
          */}
          <form action={activeAction}>
            <input type="hidden" name="userId" value={member.id} />
            <input type="hidden" name="active" value={String(member.deactivated)} />
            <SubmitButton
              size="sm"
              variant={member.deactivated ? 'secondary' : 'ghost'}
              loadingLabel="…"
            >
              {member.deactivated ? 'Restore' : 'Deactivate'}
            </SubmitButton>
          </form>
        </div>
      </div>

      {result && (
        <Alert tone={result.tone} className="mt-3">
          {result.text}
        </Alert>
      )}
    </li>
  );
}
