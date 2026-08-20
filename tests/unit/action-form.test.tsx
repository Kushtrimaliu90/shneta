import { useActionState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionForm } from '@/components/ui/action-form';

/**
 * Guards for "a rejected submission must not empty the form I just filled in".
 *
 * Companion to `form-draft.test.tsx`, which covers the same React 19 behaviour for the admin editors.
 * The two mechanisms exist because the situations differ — see the note in `action-form.tsx`.
 *
 * The case here is a customer form: no saved record behind the fields, so "restore what was typed" is
 * the whole requirement.
 */

type State = { ok: false; error: string } | { ok: true; data: string } | null;

/** Shaped like the checkout form: seeded contact fields, a free-text note, and a coupon in the same form. */
function Checkout({
  reject = true,
  defaultEmail = '',
}: {
  reject?: boolean;
  defaultEmail?: string;
}) {
  const [state, action] = useActionState<State, FormData>(
    async (_previous, formData) =>
      reject
        ? { ok: false, error: `coupon_minimum:${String(formData.get('couponCode'))}` }
        : { ok: true, data: 'placed' },
    null,
  );

  return (
    <ActionForm action={action} state={state}>
      <input data-testid="email" name="email" type="email" defaultValue={defaultEmail} />
      <input data-testid="phone" name="phone" type="tel" />
      <input data-testid="password" name="password" type="password" />
      <textarea data-testid="notes" name="notes" />
      <input data-testid="coupon" name="couponCode" />
      <button type="submit">place order</button>
      <output data-testid="out">{state ? (state.ok ? state.data : state.error) : ''}</output>
    </ActionForm>
  );
}

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement | HTMLTextAreaElement;
const settled = (text: string) =>
  waitFor(() => expect(screen.getByTestId('out').textContent).toContain(text));

function fill() {
  fireEvent.change(field('email'), { target: { value: 'agron@example.com' } });
  fireEvent.change(field('phone'), { target: { value: '049123456' } });
  fireEvent.change(field('notes'), { target: { value: 'Leave at the door, second floor' } });
  fireEvent.change(field('coupon'), { target: { value: 'WELCOME10' } });
}

describe('the behaviour being worked around', () => {
  it('a plain form loses everything when the action reports failure', async () => {
    // The reported bug, asserted against a bare <form> so the regression is visible if React changes.
    function Bare() {
      const [state, action] = useActionState<string | null, FormData>(async () => 'rejected', null);
      return (
        <form action={action}>
          <input data-testid="email" name="email" />
          <button type="submit">go</button>
          <output data-testid="out">{state}</output>
        </form>
      );
    }
    render(<Bare />);
    fireEvent.change(field('email'), { target: { value: 'agron@example.com' } });
    fireEvent.click(screen.getByText('go'));
    await settled('rejected');

    expect(field('email').value).toBe('');
  });
});

describe('ActionForm', () => {
  it('keeps every text field when the coupon is rejected', async () => {
    render(<Checkout />);
    fill();
    fireEvent.click(screen.getByText('place order'));
    await settled('coupon_minimum:WELCOME10');

    expect(field('email').value).toBe('agron@example.com');
    expect(field('phone').value).toBe('049123456');
    expect(field('notes').value).toBe('Leave at the door, second floor');
    expect(field('coupon').value).toBe('WELCOME10');
  });

  it('does not keep the password', async () => {
    render(<Checkout />);
    fireEvent.change(field('password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByText('place order'));
    await settled('coupon_minimum');

    // Deliberate: a failed attempt clears the password, as every other site does.
    expect(field('password').value).toBe('');
  });

  it('still clears the form on success', async () => {
    /*
     * The reset is correct behaviour when the action succeeded — restoring there would redisplay a
     * placed order's details as though they were still awaiting submission.
     */
    render(<Checkout reject={false} />);
    fill();
    fireEvent.click(screen.getByText('place order'));
    await settled('placed');

    expect(field('email').value).toBe('');
    expect(field('notes').value).toBe('');
  });

  it('survives two rejections in a row', async () => {
    render(<Checkout />);
    fill();
    fireEvent.click(screen.getByText('place order'));
    await settled('coupon_minimum:WELCOME10');
    expect(field('email').value).toBe('agron@example.com');

    // A second failure returns a different object with the same `ok: false`; restoring must fire again.
    fireEvent.change(field('coupon'), { target: { value: 'SUMMER20' } });
    fireEvent.click(screen.getByText('place order'));
    await settled('coupon_minimum:SUMMER20');
    expect(field('email').value).toBe('agron@example.com');
    expect(field('coupon').value).toBe('SUMMER20');
  });

  it('respects a field the customer deliberately emptied', async () => {
    // Seeded from the session, then cleared on purpose. Putting it back would fight the customer.
    render(<Checkout defaultEmail="stale@example.com" />);
    fireEvent.change(field('email'), { target: { value: '' } });
    fireEvent.click(screen.getByText('place order'));
    await settled('coupon_minimum');

    expect(field('email').value).toBe('');
  });

  it('leaves a controlled field to React', async () => {
    /*
     * The safety rule, asserted. Only empty fields are restored, so a React-controlled input — which is
     * never empty after the reset, because React re-asserts its state — cannot be clobbered. Checkout's
     * shipping-method radio is controlled this way, and a DOM value disagreeing with React state would
     * be a worse bug than the data loss being fixed.
     */
    function Controlled() {
      const [state, action] = useActionState<State, FormData>(
        async () => ({ ok: false, error: 'rejected' }),
        null,
      );
      return (
        <ActionForm action={action} state={state}>
          <input data-testid="city" name="city" value="Prishtinë" onChange={() => {}} />
          <button type="submit">go</button>
          <output data-testid="out">{state && !state.ok ? state.error : ''}</output>
        </ActionForm>
      );
    }
    render(<Controlled />);
    fireEvent.click(screen.getByText('go'));
    await settled('rejected');

    expect(field('city').value).toBe('Prishtinë');
  });
});
