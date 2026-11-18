import { useEffect, useRef } from 'react';

/** Modal confirmation for destructive actions (native <dialog>: focus-trapped, Esc closes). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="confirm" onCancel={onCancel} onClose={onCancel} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      <p className="muted">{body}</p>
      <div className="row">
        <button type="button" className="button" onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="button primary danger-fill" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
