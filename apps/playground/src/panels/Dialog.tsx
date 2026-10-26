import { type ReactNode, useEffect, useRef } from "react";

/** A modal `<dialog>`: Escape and the close button both call `onClose`. */
export const Dialog = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
};
