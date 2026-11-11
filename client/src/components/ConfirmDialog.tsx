interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Inline modal dialog — never browser alerts/confirms (05).
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel} onKeyDown={undefined}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={undefined}
      >
        <h2 className="display">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
