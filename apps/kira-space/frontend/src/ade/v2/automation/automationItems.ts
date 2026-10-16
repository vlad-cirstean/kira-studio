import type { CustomScript } from '@shared/domain/scripts';
import { t } from '@theme/i18n';
import type { TaskMenuItem } from '../board/menu';

/** The Run automation submenu: one item per saved script, smart ones marked; a hint when none. */
export function automationItems(scripts: readonly CustomScript[]): TaskMenuItem[] {
  if (scripts.length === 0) {
    return [
      {
        id: 'ade-automation-none',
        label: t('space.ade.automation.none.empty'),
        cmd: { kind: 'automation', scriptId: '' },
        disabled: true,
      },
    ];
  }
  return scripts.map((s) => ({
    id: `ade-automation-${s.id}`,
    label: s.name,
    icon: s.kind === 'smart' ? 'sparkle' : undefined,
    cmd: { kind: 'automation', scriptId: s.id },
  }));
}
