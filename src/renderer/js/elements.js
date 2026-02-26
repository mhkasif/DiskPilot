// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

export const el = {
  btnScan        : $('btn-scan'),
  btnRefresh     : $('btn-refresh'),
  btnStop        : $('btn-stop'),
  btnDelete      : $('btn-delete'),
  btnShowFinder  : $('btn-show-finder'),
  btnExpandAll   : $('btn-expand-all'),
  btnCollapseAll : $('btn-collapse-all'),
  btnSettings    : $('btn-settings'),
  driveSelect    : $('drive-select'),
  pathInput      : $('path-input'),
  btnBrowse      : $('btn-browse'),
  unitSelect     : $('unit-select'),
  gridHeader     : $('grid-header'),
  // states
  stateOnboarding: $('state-onboarding'),
  stateEmpty     : $('state-empty'),
  stateScanning  : $('state-scanning'),
  treeWrap       : $('tree-wrap'),
  // scan state
  scanHeadline   : $('scan-headline'),
  scanCurrentPath: $('scan-current-path'),
  scanCurrentSize: $('scan-current-size'),
  scanProgressBar: $('scan-progress-bar'),
  scanEta        : $('scan-eta'),
  btnCancelScan  : $('btn-cancel-scan'),
  // virtual scroller
  treeScroll     : $('tree-scroll'),
  virtSpacer     : $('virt-spacer'),
  treeInner      : $('tree-inner'),
  // status bar
  sbStatus       : $('sb-status'),
  sbPath         : $('sb-path'),
  sbTotalSize    : $('sb-total-size'),
  sbTotalFiles   : $('sb-total-files'),
  sbScanTime     : $('sb-scan-time'),
  // context menu
  ctxMenu        : $('ctx-menu'),
  // onboarding
  onbScanBtn     : $('onb-scan-btn'),
  btnStartScan   : $('btn-start-scan'),
  // settings
  settingsOverlay: $('settings-overlay'),
  settingsClose  : $('settings-close'),
  themePicker    : $('theme-picker'),
  settingsUnits  : $('settings-units'),
  settingsDepth  : $('settings-expand-depth'),
  toggleHidden   : $('toggle-hidden'),
  // tooltip
  tooltip        : $('tooltip'),
  // chart / treemap
  btnViewTree     : $('btn-view-tree'),
  btnViewTreemap  : $('btn-view-treemap'),
  btnViewBarchart : $('btn-view-barchart'),
  btnViewPiechart : $('btn-view-piechart'),
  chartWrap       : $('chart-wrap'),
  chartBreadcrumb : $('chart-breadcrumb'),
  treemapContainer: $('treemap-container'),
};
