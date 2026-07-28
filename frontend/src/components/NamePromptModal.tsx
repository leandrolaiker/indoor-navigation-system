import { FormEvent, useState } from 'react';

interface NamePromptModalProps {
  title: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function NamePromptModal({
  title,
  initialValue = '',
  confirmLabel = 'Guardar',
  onConfirm,
  onCancel,
}: NamePromptModalProps) {
  const [value, setValue] = useState(initialValue);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <form
        className="modal-box"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3>{title}</h3>
        <input
          autoFocus
          type="text"
          value={value}
          maxLength={80}
          placeholder="Nombre"
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
