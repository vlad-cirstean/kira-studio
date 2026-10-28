import type { CustomScript, ScriptCollection, ScriptKind } from '@shared/domain/scripts';
import { t } from '@theme/i18n';
import { moveToCollectionMenu } from '../lib/collectionMenu';
import type { MenuItem } from '../state/contextMenu';

// Pure descriptions of the panel's context menus; AutomationsPanel.vue injects what each item does.

export interface MoveStepActions<T> {
  /** One place within the row's own set. */
  moveStep(item: T, step: -1 | 1): void;
  canMoveStep(item: T, step: -1 | 1): boolean;
}

export interface ScriptMenuActions extends MoveStepActions<CustomScript> {
  run(script: CustomScript): void | Promise<void>;
  runNow(script: CustomScript): void;
  editSchedule(script: CustomScript): void;
  edit(script: CustomScript): void;
  collections(): readonly ScriptCollection[];
  moveTo(script: CustomScript, collectionId: string | null): void | Promise<void>;
  moveToNew(script: CustomScript): void | Promise<void>;
  remove(script: CustomScript): void | Promise<void>;
}

export interface CollectionMenuActions extends MoveStepActions<ScriptCollection> {
  newScript(kind: ScriptKind, collectionId: string | null): void;
  rename(collection: ScriptCollection): void;
  remove(collection: ScriptCollection): void | Promise<void>;
}

export function newScriptItems(
  open: (kind: ScriptKind, collectionId: string | null) => void,
  collectionId: string | null,
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-script',
      label: t('automations.script.new.label'),
      icon: 'add',
      run: () => open('script', collectionId),
    },
    {
      type: 'item',
      id: 'new-smart-script',
      label: t('automations.script.newSmart.label'),
      icon: 'sparkle',
      run: () => open('smart', collectionId),
    },
  ];
}

function moveItems<T>(item: T, actions: MoveStepActions<T>): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'move-up',
      label: t('common.moveUp.tooltip'),
      icon: 'arrow-up',
      shortcut: 'list.moveUp',
      disabled: !actions.canMoveStep(item, -1),
      run: () => actions.moveStep(item, -1),
    },
    {
      type: 'item',
      id: 'move-down',
      label: t('common.moveDown.tooltip'),
      icon: 'arrow-down',
      shortcut: 'list.moveDown',
      disabled: !actions.canMoveStep(item, 1),
      run: () => actions.moveStep(item, 1),
    },
  ];
}

export function scriptMenu(script: CustomScript, actions: ScriptMenuActions): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'run',
      label: t('common.action.run.label'),
      icon: 'play',
      run: () => actions.run(script),
    },
    ...(script.schedule
      ? ([
          {
            type: 'item',
            id: 'run-now',
            label: t('automations.script.runNow.label'),
            icon: 'debug-start',
            run: () => actions.runNow(script),
          },
          {
            type: 'item',
            id: 'edit-schedule',
            label: t('automations.script.editSchedule.label'),
            icon: 'watch',
            run: () => actions.editSchedule(script),
          },
        ] satisfies MenuItem[])
      : []),
    {
      type: 'item',
      id: 'edit',
      label: t('common.action.edit.label'),
      icon: 'edit',
      run: () => actions.edit(script),
    },
    moveToCollectionMenu({
      collections: actions.collections(),
      current: script.collectionId,
      allowNone: true,
      onMove: (id) => actions.moveTo(script, id),
      onNew: () => actions.moveToNew(script),
    }),
    ...moveItems(script, actions),
    { type: 'separator' },
    {
      type: 'item',
      id: 'remove',
      label: t('common.action.remove.label'),
      icon: 'trash',
      danger: true,
      run: () => actions.remove(script),
    },
  ];
}

export function collectionMenu(
  collection: ScriptCollection,
  actions: CollectionMenuActions,
): MenuItem[] {
  return [
    ...newScriptItems(actions.newScript, collection.id),
    {
      type: 'item',
      id: 'rename',
      label: t('common.action.rename.label'),
      icon: 'edit',
      run: () => actions.rename(collection),
    },
    ...moveItems(collection, actions),
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: t('common.action.delete.label'),
      icon: 'trash',
      danger: true,
      run: () => actions.remove(collection),
    },
  ];
}
