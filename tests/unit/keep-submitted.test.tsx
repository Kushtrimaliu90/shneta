import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keepSubmitted, submittedValues } from '@/lib/keep-submitted';
import { ActionForm, useSubmitted } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { fail, ok, type ActionResult } from '@/lib/result';

/**
 * The half of the form fix that works without JavaScript.
 *
 * `action-form.test.tsx` covers the browser half — snapshot the fields, put them back when the action
 * fails. That needs a hydrated page. These cover the other path: the values travel back from the
 * server and arrive as `defaultValue`, which is the only thing that can refill a form posted before
 * hydration (docs/13 §AW).
 */

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

describe('submittedValues', () => {
  it('keeps every value of a repeated name', () => {
    /*
     * The `Object.fromEntries` mistake documented in use-form-draft.ts: it keeps only the last value
     * per key, so a checkbox group sharing a name would come back with one box ticked.
     */
    const values = submittedValues(
      form([
        ['tags', 'vegan'],
        ['tags', 'halal'],
        ['name', 'Agron'],
      ]),
    );
    expect(values.tags).toEqual(['vegan', 'halal']);
    expect(values.name).toEqual(['Agron']);
  });

  it('never hands a password back', () => {
    // It would otherwise be written into the HTML of the response.
    const values = submittedValues(
      form([
        ['email', 'a@b.com'],
        ['password', 'hunter2'],
        ['newPassword', 'hunter3'],
        ['confirmPassword', 'hunter3'],
      ]),
    );
    expect(Object.keys(values)).toEqual(['email']);
  });

  it('drops secrets and card details by name', () => {
    const values = submittedValues(
      form([
        ['cardNumber', '4111'],
        ['cvv', '123'],
        ['otp', '000000'],
        ['city', 'Prishtine'],
      ]),
    );
    expect(Object.keys(values)).toEqual(['city']);
  });

  it('skips a file, which cannot be seeded back', () => {
    const data = form([['label', 'front']]);
    data.append('photo', new File(['x'], 'box.jpg', { type: 'image/jpeg' }));
    expect(Object.keys(submittedValues(data))).toEqual(['label']);
  });

  it('keeps a field submitted empty', () => {
    // Present-but-empty is meaningful: it means deliberately cleared, not absent.
    expect(submittedValues(form([['email', '']])).email).toEqual(['']);
  });
});

describe('keepSubmitted', () => {
  it('attaches what was posted when the action fails', async () => {
    const action = keepSubmitted(async () => fail('coupon_minimum') as ActionResult<void, string>);
    const result = await action(null, form([['couponCode', 'WELCOME10']]));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.submitted?.couponCode).toEqual(['WELCOME10']);
  });

  it('attaches nothing when the action succeeds', async () => {
    /*
     * A form that succeeded should clear. Echoing a placed order's details back into the fields would
     * suggest it still needed submitting.
     */
    const action = keepSubmitted(async () => ok({ orderNumber: 'BIO-1' }));
    const result = await action(null, form([['email', 'a@b.com']]));

    expect(result).toEqual({ ok: true, data: { orderNumber: 'BIO-1' } });
    expect('submitted' in result).toBe(false);
  });

  it('leaves the original error and fieldErrors intact', async () => {
    const action = keepSubmitted(
      async () => fail('invalid', { email: ['Required'] }) as ActionResult<void, string>,
    );
    const result = await action(null, form([['email', 'nope']]));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid');
      expect(result.fieldErrors).toEqual({ email: ['Required'] });
    }
  });

  it('lets a redirect through', async () => {
    // Server actions signal navigation by throwing; swallowing it would render a blank success.
    const action = keepSubmitted(async () => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(action(null, form([]))).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('reading the values back', () => {
  /** What the server renders after a rejected POST: a failure state carrying `submitted`. */
  const rejected = (submitted: Record<string, string[]>) => ({
    ok: false as const,
    error: 'invalid',
    submitted,
  });
  const value = () => (screen.getByRole('textbox') as HTMLInputElement).value;

  it('refills an Input with no wiring at the call site', () => {
    render(
      <ActionForm action={() => {}} state={rejected({ email: ['agron@example.com'] })}>
        <Input name="email" />
      </ActionForm>,
    );
    expect(value()).toBe('agron@example.com');
  });

  it('prefers what was submitted over a seeded default', () => {
    render(
      <ActionForm action={() => {}} state={rejected({ email: ['typed@example.com'] })}>
        <Input name="email" defaultValue="stale@example.com" />
      </ActionForm>,
    );
    expect(value()).toBe('typed@example.com');
  });

  it('honours a field cleared on purpose', () => {
    // Submitted empty beats the seed, or an address somebody removed reappears.
    render(
      <ActionForm action={() => {}} state={rejected({ email: [''] })}>
        <Input name="email" defaultValue="stale@example.com" />
      </ActionForm>,
    );
    expect(value()).toBe('');
  });

  it('leaves a controlled Input to React', () => {
    render(
      <ActionForm action={() => {}} state={rejected({ city: ['Peje'] })}>
        <Input name="city" value="Prishtine" onChange={() => {}} />
      </ActionForm>,
    );
    expect(value()).toBe('Prishtine');
  });

  it('changes nothing on a successful state', () => {
    render(
      <ActionForm action={() => {}} state={{ ok: true, data: null }}>
        <Input name="email" defaultValue="seeded@example.com" />
      </ActionForm>,
    );
    expect(value()).toBe('seeded@example.com');
  });

  it('reaches a raw field through useSubmitted', () => {
    /*
     * Raw elements cannot read context themselves, so they route through the hook. This is the shape
     * used by the contact message, the review body and the checkout note.
     */
    function Note() {
      const note = useSubmitted('body');
      return <textarea name="body" defaultValue={note} />;
    }
    render(
      <ActionForm action={() => {}} state={rejected({ body: ['Ku eshte porosia ime?'] })}>
        <Note />
      </ActionForm>,
    );
    expect(value()).toBe('Ku eshte porosia ime?');
  });

  it('reaches through a render prop, which a children walk could not', () => {
    /*
     * The reason this is context and not a walk over `children`: `Field` takes its children as a
     * function, so the input it labels does not exist as an element until it is called.
     */
    function Labelled({ children }: { children: () => React.ReactNode }) {
      return <label>{children()}</label>;
    }
    render(
      <ActionForm action={() => {}} state={rejected({ phone: ['049123456'] })}>
        <Labelled>{() => <Input name="phone" />}</Labelled>
      </ActionForm>,
    );
    expect(value()).toBe('049123456');
  });
});
