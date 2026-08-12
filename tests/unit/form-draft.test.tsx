import { useActionState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFormDraft } from '@/components/ui/use-form-draft';

/**
 * Guards for "a rejected save must not lose what I typed".
 *
 * These replace `zzz-probe-reset.test.tsx`, which investigated this behaviour with three
 * `expect(true).toBe(true)` cases and some `console.log` — it could not fail, so it was not protecting
 * anything. The behaviour it was probing is exactly what is being relied on here, so it is asserted.
 */

/** A form shaped like the product editor's General tab: one text field and one checkbox group. */
function Editor({
  useDraft,
  reject = true,
  savedText = 'saved-slug',
  savedTags = ['vegan'],
}: {
  useDraft: boolean;
  reject?: boolean;
  savedText?: string;
  savedTags?: string[];
}) {
  const draft = useFormDraft();

  const [state, action] = useActionState<string | null, FormData>(
    async (_previous, formData) => {
      if (useDraft) draft.capture(formData);
      if (!reject) {
        if (useDraft) draft.clear();
        return 'ok';
      }
      return `rejected:${String(formData.get('slug'))}`;
    },
    null,
  );

  return (
    <form action={action} key={useDraft ? draft.attempt : undefined}>
      <input
        data-testid="slug"
        name="slug"
        defaultValue={useDraft ? draft.text('slug', savedText) : savedText}
      />
      {['vegan', 'gluten_free', 'halal'].map((tag) => (
        <input
          key={tag}
          data-testid={`tag-${tag}`}
          type="checkbox"
          name="tags"
          value={tag}
          defaultChecked={
            useDraft ? draft.selected('tags', tag, savedTags.includes(tag)) : savedTags.includes(tag)
          }
        />
      ))}
      <button type="submit">save</button>
      <output data-testid="out">{state}</output>
    </form>
  );
}

const box = (tag: string) => screen.getByTestId(`tag-${tag}`) as HTMLInputElement;
const slug = () => screen.getByTestId('slug') as HTMLInputElement;

describe('the behaviour being worked around', () => {
  it('React 19 wipes an uncontrolled form after the action, even on failure', async () => {
    render(<Editor useDraft={false} />);

    fireEvent.change(slug(), { target: { value: 'what-i-typed' } });
    fireEvent.click(box('halal'));
    expect(slug().value).toBe('what-i-typed');

    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('rejected:'));

    /*
     * The defect, asserted. The action reported a failure and React reset the form anyway — the typing
     * is back to the saved record, and the newly ticked box is back to unticked. This is what an editor
     * experienced as "it lost everything I filled in".
     */
    expect(slug().value).toBe('saved-slug');
    expect(box('halal').checked).toBe(false);
  });
});

describe('useFormDraft', () => {
  it('gives back what was typed when the save is rejected', async () => {
    render(<Editor useDraft />);

    fireEvent.change(slug(), { target: { value: 'what-i-typed' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('rejected:'));

    expect(slug().value).toBe('what-i-typed');
  });

  it('keeps EVERY box of a repeated-name group, not just the last', async () => {
    /*
     * The reason this is a hook rather than a sixth copy of the pattern.
     *
     * `Object.fromEntries(formData.entries())` — what the other five editors use — keeps only the last
     * value per key, so a group sharing one `name` would come back with a single box ticked. Here all
     * three are ticked before submitting and all three must survive.
     */
    render(<Editor useDraft savedTags={[]} />);

    fireEvent.click(box('vegan'));
    fireEvent.click(box('gluten_free'));
    fireEvent.click(box('halal'));

    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('rejected:'));

    expect(box('vegan').checked).toBe(true);
    expect(box('gluten_free').checked).toBe(true);
    expect(box('halal').checked).toBe(true);
  });

  it('demonstrates the collapse it avoids', () => {
    // Not a test of the hook — a test of the claim in its comment, so the claim cannot rot.
    const formData = new FormData();
    formData.append('tags', 'vegan');
    formData.append('tags', 'gluten_free');
    formData.append('tags', 'halal');

    expect(Object.fromEntries(formData.entries()).tags).toBe('halal');
    expect(formData.getAll('tags')).toHaveLength(3);
  });

  it('leaves a box the editor cleared cleared', async () => {
    /*
     * An unchecked box submits nothing at all, so an absent key means "deliberately cleared" and must
     * not fall back to the saved value — re-ticking what somebody just unticked is a worse bug than the
     * data loss this fixes.
     */
    render(<Editor useDraft savedTags={['vegan']} />);
    expect(box('vegan').checked).toBe(true);

    fireEvent.click(box('vegan'));
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('rejected:'));

    expect(box('vegan').checked).toBe(false);
  });

  it('falls back to the saved record once the save succeeds', async () => {
    render(<Editor useDraft reject={false} />);

    fireEvent.change(slug(), { target: { value: 'transient' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ok'));

    /*
     * After a successful save the draft is cleared, so the form shows the record rather than an echo of
     * the typing. In the real editor the server has also revalidated and `product` arrives updated;
     * holding the echo would show stale text next to a "Saved." confirmation.
     */
    expect(slug().value).toBe('saved-slug');
  });

  it('survives two rejections in a row', async () => {
    render(<Editor useDraft />);

    fireEvent.change(slug(), { target: { value: 'first-try' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('rejected:first-try'));
    expect(slug().value).toBe('first-try');

    // The remount key changed; the second attempt must still capture and echo.
    fireEvent.change(slug(), { target: { value: 'second-try' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('rejected:second-try'));
    expect(slug().value).toBe('second-try');
  });
});
