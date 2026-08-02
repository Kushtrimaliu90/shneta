'use client';

import { useActionState, useState } from 'react';
import { Award, Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  deleteCertification,
  saveCertification,
  type CertificationErrorKey,
  type CertificationState,
} from '@/features/catalog/certification-actions';

const ERRORS: Record<CertificationErrorKey, string> = {
  'admin.errors.forbidden': 'Only compliance can change the registry.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.certifications.errors.checkFields': 'Check the fields marked below.',
  'admin.certifications.errors.slugTaken': 'Another certification already uses that code.',
  'admin.certifications.errors.inUse':
    'Products still carry this certification. Remove it from them first — otherwise their badges would vanish with no record of why.',
};

export interface CertificationItem {
  id: string;
  slug: string;
  nameSq: string;
  nameEn: string;
  productCount: number;
}

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

function message(state: CertificationState): string | null {
  if (!state || state.ok) return null;
  const field = Object.values(state.fieldErrors ?? {})[0]?.[0];
  return field ?? ERRORS[state.error as CertificationErrorKey];
}

/** docs/06 §14 — the certifications registry. */
export function CertificationsAdmin({ items }: { items: CertificationItem[] }) {
  const [editing, setEditing] = useState<CertificationItem | 'new' | null>(null);

  return (
    <div>
      <div className="mb-4">
        {editing === 'new' ? (
          <CertificationForm item={null} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden="true" />
            New certification
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center">
          <Award className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-carbon-900">No certifications yet</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <CertificationRow
              key={item.id}
              item={item}
              isEditing={editing !== 'new' && editing?.id === item.id}
              onEdit={() => setEditing(item)}
              onDone={() => setEditing(null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CertificationRow({
  item,
  isEditing,
  onEdit,
  onDone,
}: {
  item: CertificationItem;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [state, action] = useActionState<CertificationState, FormData>(deleteCertification, null);
  const error = message(state);

  return (
    <li className="rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <p className="text-sm font-medium text-ink-900">
            {item.nameSq}
            {item.nameEn && <span className="ml-2 text-xs text-ink-500">{item.nameEn}</span>}
          </p>
          <p className="font-mono text-xs text-ink-500">{item.slug}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-600" data-numeric>
            {item.productCount} product{item.productCount === 1 ? '' : 's'}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {item.productCount === 0 && (
            <form action={action}>
              <input type="hidden" name="id" value={item.id} />
              <SubmitButton size="sm" variant="ghost" loadingLabel="…">
                Delete
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 pb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {isEditing && (
        <div className="border-t border-line bg-carbon-50/60 p-3">
          <CertificationForm item={item} onDone={onDone} />
        </div>
      )}
    </li>
  );
}

function CertificationForm({
  item,
  onDone,
}: {
  item: CertificationItem | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState<CertificationState, FormData>(saveCertification, null);
  const error = message(state);
  const key = item?.id ?? 'new';

  return (
    <form action={action} className="rounded-sm border border-line-strong bg-surface p-3">
      {item && <input type="hidden" name="id" value={item.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`slug-${key}`} className={labelClass}>
            Code <span className="text-error">*</span>
          </label>
          <input
            id={`slug-${key}`}
            name="slug"
            defaultValue={item?.slug ?? ''}
            required
            placeholder="gmp"
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label htmlFor={`nameSq-${key}`} className={labelClass}>
            Name (Albanian) <span className="text-error">*</span>
          </label>
          <input
            id={`nameSq-${key}`}
            name="nameSq"
            defaultValue={item?.nameSq ?? ''}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`nameEn-${key}`} className={labelClass}>
            Name (English)
          </label>
          <input
            id={`nameEn-${key}`}
            name="nameEn"
            defaultValue={item?.nameEn ?? ''}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          {item ? 'Save' : 'Create'}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {state?.ok && <span className="text-sm text-success">Saved.</span>}
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </form>
  );
}
