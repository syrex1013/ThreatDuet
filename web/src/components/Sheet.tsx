import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMedia } from '../lib';

interface SheetProps {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A modal panel: slides in from the right on wide screens, up from the bottom on phones.
 * Native <dialog> provides the focus trap and Escape; Motion animates the open and close.
 */
export function Sheet({ title, wide, onClose, children, footer }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  const reduce = useReducedMotion();
  const bottom = useMedia('(max-width: 959px)');

  useEffect(() => ref.current?.showModal(), []);

  const close = () => setOpen(false);
  const finish = () => {
    ref.current?.close();
    onClose();
  };

  const slide = bottom ? { y: '100%' } : { x: '12%', opacity: 0 };
  const transition = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 42, mass: 0.9 };

  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? 'sheet-wide' : ''} ${open ? '' : 'is-closing'}`}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === ref.current && close()}
    >
      <AnimatePresence onExitComplete={finish}>
        {open && (
          <motion.div className="sheet-inner" initial={slide} animate={{ x: 0, y: 0, opacity: 1 }} exit={slide} transition={transition}>
            <header className="sheet-head">
              {bottom && <span className="sheet-grip" aria-hidden="true" />}
              <h2 id="sheet-title">{title}</h2>
              <button type="button" className="icon-btn" onClick={close} aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="sheet-body">{children}</div>
            {footer && <footer className="sheet-foot">{footer}</footer>}
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
}
