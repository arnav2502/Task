/** Toasts and confirm dialogs, available everywhere through context. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { cx } from '../utils/format';
import { errorMessage } from '../services/api';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (kind: ToastKind, message: string) => void;
  /** Shows the error as a toast. */
  fail: (err: unknown) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

const STYLE: Record<ToastKind, { icon: IconName; cls: string }> = {
  success: { icon: 'checkCircle', cls: 'text-emerald-300' },
  error: { icon: 'xCircle', cls: 'text-rose-300' },
  info: { icon: 'info', cls: 'text-sky-300' },
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({
      toast,
      fail: (err) => toast('error', errorMessage(err)),
      confirm: (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    }),
    [toast],
  );

  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl border border-white/10 bg-ink-750/95 px-4 py-3 text-sm text-slate-100 shadow-2xl backdrop-blur">
            <Icon name={STYLE[t.kind].icon} size={18} className={cx('mt-0.5 shrink-0', STYLE[t.kind].cls)} />
            <span className="flex-1 break-words">{t.message}</span>
            <button type="button" aria-label="Dismiss" className="text-slate-500 hover:text-white" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => close(false)}
          width="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <div className="text-sm text-slate-300">{pending.message}</div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback outside FeedbackProvider');
  return v;
}
