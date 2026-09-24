/** `packages/kira-ui`'s public surface (G19 D3) — `@kira/kira-ui`'s own `./src/index.ts`,
 *  matching every other workspace package's convention. */

export { cn } from './cn.ts';
export type { MenuItem, MenuSection } from './contextMenuModel.ts';
export { enabledNeighbour, firstEnabled, flattenItems } from './contextMenuModel.ts';
export type { FloatOptions, ReferenceElement } from './floatingPosition.ts';
export {
  autoUpdate,
  computeFloatPosition,
  FLOAT_MAX_HEIGHT_VAR,
  FLOAT_MAX_WIDTH_VAR,
  pointReference,
} from './floatingPosition.ts';
export { default as KuiButton } from './KuiButton.vue';
export { default as KuiColumnResizeHandle } from './KuiColumnResizeHandle.vue';
export { default as KuiContextMenu } from './KuiContextMenu.vue';
export { default as KuiDialog } from './KuiDialog.vue';
export { default as KuiIconBox } from './KuiIconBox.vue';
export { default as KuiMenuList } from './KuiMenuList.vue';
export { default as KuiPopoverPanel } from './KuiPopoverPanel.vue';
export { default as KuiSearchInput } from './KuiSearchInput.vue';
export { default as KuiSegmented } from './KuiSegmented.vue';
export { default as KuiSelect } from './KuiSelect.vue';
export { default as KuiTextInput } from './KuiTextInput.vue';
export { default as KuiTooltip } from './KuiTooltip.vue';
export { useModalFocus } from './modalFocus.ts';
export type { KuiSegmentedOption, KuiSelectOption } from './optionTypes.ts';
export {
  getAnchorElement,
  initTooltips,
  isWithinRearmWindow,
  TOOLTIP_DELAY_MS,
  TOOLTIP_REARM_MS,
  tooltipState,
  vKuiTooltip,
} from './tooltip.ts';
