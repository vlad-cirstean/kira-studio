import type { TreeNode } from '@shared/domain/tree';
import { copyText } from '../../clipboard';
import { connectionRecord, connectionsState } from '../../state/connections';
import type { MenuItem } from '../../state/contextMenu';
import { deleteObject, downloadObject, uploadMenuItem } from '../../state/objectStore';
import { openKeyValueTab } from '../../state/tabs';
import { nodeIcon } from '../../theme/icons';
import { reload } from './state';

// P41 D10: the bodies of project/menus.ts's now-deleted namespaceMenu/prefixMenu (a container row
// — redis 'namespace' / s3 'prefix') and keyMenu/objectMenu (a leaf row — redis 'key' / s3
// 'object'), moved here verbatim once the tree stopped rendering any of these rows at all (D5).
// `refresh(parent)`'s tree-row refresh becomes a local level reload — there is no longer a parent
// tree row to refresh, only this panel's own currently loaded level.

function containerRowMenu(tabId: string, connectionId: string, node: TreeNode): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      run: () => void reload(tabId),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(node.name),
    },
    // Gates itself on caps.fileTransfer/canInsert — a no-op list for redis's own 'namespace' rows
    // (P33 D3), the same as project/menus.ts's own namespaceMenu-vs-prefixMenu split used to be.
    ...uploadMenuItem(connectionId, node.path),
  ];
}

// P9's key leaf, moved verbatim: minimal open/copy-name only (D14) — no download/delete rows
// regardless of caps.canDelete (redis's own is true), per the read-only-tree-row scope decision
// this phase does not revisit.
function keyRowMenu(connectionId: string, node: TreeNode): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open',
      label: 'Open',
      icon: nodeIcon(node.kind),
      shortcut: 'tree.open',
      run: () => {
        openKeyValueTab(connectionId, node.path);
      },
    },
    {
      type: 'item',
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: nodeIcon(node.kind),
      run: () => {
        openKeyValueTab(connectionId, node.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(node.name),
    },
  ];
}

// P17's S3 object leaf, moved verbatim: open/open-in-new-tab/copy-name plus P33's Download and
// Delete, each gated on the connection's own caps/read-only state rather than shown permanently
// disabled.
function objectRowMenu(tabId: string, connectionId: string, node: TreeNode): MenuItem[] {
  const caps = connectionsState.states[connectionId]?.caps;
  const record = connectionRecord(connectionId);
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'open',
      label: 'Open',
      icon: nodeIcon(node.kind),
      shortcut: 'tree.open',
      run: () => {
        openKeyValueTab(connectionId, node.path);
      },
    },
    {
      type: 'item',
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: nodeIcon(node.kind),
      run: () => {
        openKeyValueTab(connectionId, node.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(node.name),
    },
  ];

  if (caps?.fileTransfer) {
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      id: 'download-object',
      label: 'Download…',
      icon: 'cloud-download',
      run: () => void downloadObject(connectionId, node.path, null),
    });
  }

  if (caps?.canDelete && !record?.readOnly) {
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      id: 'delete-object',
      label: 'Delete',
      icon: 'trash',
      danger: true,
      shortcut: 'tree.delete',
      run: async () => {
        if (!window.confirm(`Delete object "${node.name}"? This cannot be undone.`)) return;
        await deleteObject(connectionId, node.path, null);
        await reload(tabId);
      },
    });
  }

  return items;
}

export function menuForNode(tabId: string, connectionId: string, node: TreeNode): MenuItem[] {
  if (node.hasChildren) return containerRowMenu(tabId, connectionId, node);
  return node.kind === 'object'
    ? objectRowMenu(tabId, connectionId, node)
    : keyRowMenu(connectionId, node);
}
