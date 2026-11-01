import type { TaskItem } from '../../../src/shared/types';
import { t } from '../i18n';
import { TaskList } from './Panel';
import { Sheet } from './Sheet';

/** Duet's ideas, offered when the app starts and now and then. Closing it marks the batch seen on every device. */
export function Recommendations({
  tasks,
  onStart,
  onComplete,
  onDismiss,
  onClose,
}: {
  tasks: TaskItem[];
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDismiss: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={t('Duet has some ideas')} onClose={onClose}>
      <p className="hint">{t("Things Duet could do for you now. Pick any to start; the rest stay under Duet's tasks.")}</p>
      <TaskList tasks={tasks} onStart={onStart} onComplete={onComplete} onDismiss={onDismiss} />
    </Sheet>
  );
}
