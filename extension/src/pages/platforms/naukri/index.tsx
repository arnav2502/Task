import { useState } from 'react';
import type { Task } from '@shared/types/index';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import type { PlatformExtension } from '../registry';
import { Button } from '../../../components/ui';
import { api } from '../../../services/api';
import { useFeedback } from '../../../app/feedback';
import { ResumeTab } from './ResumeTab';
import { ShareInterestTab } from './ShareInterestTab';

function NaukriTaskActions({ task }: { task: Task }) {
  const { confirm, toast, fail } = useFeedback();
  const [busy, setBusy] = useState(false);
  if (task.taskType !== NAUKRI_TASKS.PROFILE_UPDATE) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      icon="rotate"
      loading={busy}
      title="Use after editing your Resume headline by hand"
      onClick={async () => {
        const ok = await confirm({
          title: 'Re-learn headline baseline?',
          message:
            'Profile Update remembers your Resume headline without the update marker, so a headline that genuinely ends in “.” never loses it. Re-learn it after you edit the headline on Naukri yourself. The next run learns it again from the live text.',
          confirmLabel: 'Re-learn',
        });
        if (!ok) return;
        setBusy(true);
        try {
          await api.naukri.resetBaseline(task.accountId);
          toast('success', 'Baseline will be re-learned on the next Profile Update');
        } catch (err) {
          fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      Re-learn baseline
    </Button>
  );
}

export const naukriExtension: PlatformExtension = {
  tabs: [
    { id: 'resume', label: 'Resume', icon: 'file', component: ResumeTab },
    { id: 'share-interest', label: 'Share Interest', icon: 'send', component: ShareInterestTab },
  ],
  taskActions: NaukriTaskActions,
};
