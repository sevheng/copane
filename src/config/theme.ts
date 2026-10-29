import type { StyleDefinitionInput } from "@opentui/core"

/**
 * Claude Code's dark palette on near-black neutral greys, so the editor matches the Claude CLI
 * beside it. Clay orange is the accent (cursor, focus) only; code is mostly violet, periwinkle
 * and green. Keys are tree-sitter capture names; dotted names fall
 * back to their prefix.
 */
const claude = {
  clay: "#d77757",
  periwinkle: "#b1b9f9",
  green: "#4eba65",
  rose: "#ff6b80",
  amber: "#ffc107",
  purple: "#af87ff",
  text: "#e8e6e3",
  muted: "#999999",
  teal: "#7fcfc4",
}

export const syntaxTheme: Record<string, StyleDefinitionInput> = {
  default: { fg: claude.text },
  keyword: { fg: claude.purple },
  "keyword.return": { fg: claude.purple, italic: true },
  operator: { fg: "#a3a3a3" },
  string: { fg: "#8cc79a" },
  "string.escape": { fg: claude.teal },
  "string.special": { fg: claude.teal },
  character: { fg: "#8cc79a" },
  number: { fg: claude.teal },
  boolean: { fg: claude.teal },
  constant: { fg: claude.teal },
  "constant.builtin": { fg: claude.teal },
  comment: { fg: "#6e6e6e", italic: true },
  function: { fg: claude.periwinkle },
  "function.method": { fg: claude.periwinkle },
  "function.builtin": { fg: "#9fb0f5" },
  constructor: { fg: "#e8c07d" },
  type: { fg: "#e8c07d" },
  "type.builtin": { fg: "#e8c07d" },
  variable: { fg: claude.text },
  "variable.builtin": { fg: claude.purple, italic: true },
  "variable.parameter": { fg: "#d4d4d4", italic: true },
  "variable.member": { fg: "#c3cbe0" },
  property: { fg: "#c3cbe0" },
  attribute: { fg: "#e8c07d" },
  tag: { fg: claude.rose },
  punctuation: { fg: "#a3a3a3" },
  label: { fg: claude.periwinkle },
  module: { fg: "#e8c07d" },
  "markup.heading": { fg: claude.clay, bold: true },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.link": { fg: claude.periwinkle, underline: true },
  "markup.raw": { fg: "#8cc79a" },
  "markup.list": { fg: claude.teal },
  "markup.quote": { fg: "#6e6e6e", italic: true },
}

export const ui = {
  bg: "#121212",
  panelBg: "#171717",
  /** The AI pane's terminal: its default text and background (set in the emulator with OSC 10/11). */
  aiFg: claude.text,
  aiBg: "#121212",
  border: "#333333",
  borderFocused: claude.clay,
  text: claude.text,
  dim: "#8a8a8a",
  // File-tree rows matched by .gitignore
  ignoredFg: "#5f5f5f",
  accent: claude.clay,
  warn: claude.amber,
  error: claude.rose,
  ok: claude.green,
  selectionBg: "#2f3548",
  cursor: claude.clay,
  gutterFg: "#555555",
  gutterBg: "#171717",
  statusBg: "#0d0d0d",
  tabActiveBg: "#242424",
  tabInactiveBg: "#171717",
  // Pane headers and the 1-column dividers between panes
  headerBg: "#171717",
  headerFg: claude.muted,
  divider: "#262626",
  segmentBg: "#262626",
  accentDim: "#5a3a2e",
  currentLineBg: "#1b1b1b",
  bracketMatchBg: "#3d3d3d",
  wordOccurrenceBg: "#2c2c2c",
  indentGuideBg: "#1f1f1f",
  conflictCurrentBg: "#1e3322",
  conflictIncomingBg: "#262a45",
  conflictMarkerBg: "#242424",
  // Change markers in the line-number column, and the flash after a reload from disk
  gitAdd: claude.green,
  gitMod: claude.amber,
  gitDel: claude.rose,
  reloadBg: "#1e3322",
  /** Added and removed lines in a diff view (<diff>). */
  diffAddedBg: "#1e3322",
  diffRemovedBg: "#3a1e22",
  // Blame: after the cursor's line, and the file blame column (Alt+B)
  inlineBlame: "#5f5f5f",
  blameColumnBg: "#151515",
  blameAuthor: "#a8a8a8",
  // Unreviewed AI edits: their gutter marker and the review bar
  aiEdit: claude.purple,
  // Warning bars above a file (changed on disk, control characters) and their buttons
  warnBarBg: "#3b3415",
  warnBarHoverBg: "#4d4520",
  mergeBarBg: "#2a2716",
  aiReviewBg: "#2a2340",
  findMatchBg: "#4a3a1a",
  findCurrentBg: "#7a5a12",
  // File-tree icons: the usual language colours, softened to sit on dark greys
  iconBlue: "#6aa5d6",
  iconCyan: "#6cc4c4",
  iconYellow: "#e8c07d",
  iconOrange: claude.clay,
  iconRed: claude.rose,
  iconGreen: "#8cc79a",
  iconPurple: claude.purple,
  iconFolder: "#d4a27f",
  // Shade over the screen behind large dialogs (alpha-blended, so the text behind stays faintly visible)
  modalBackdrop: "#000000a0",
  // Markdown preview
  mdHeading: claude.clay,
  mdSubheading: claude.periwinkle,
  mdLink: claude.periwinkle,
  mdCode: "#8cc79a",
  mdCodeBg: "#1d1d1d",
  mdRule: "#3a3a3a",
  mdNote: "#6aa5d6",
  mdTip: claude.green,
  mdImportant: claude.purple,
  mdWarning: claude.amber,
  mdCaution: claude.rose,
}

/** Colours for OpenTUI's <diff> (spread into its props). */
export const diffColors = {
  fg: ui.text,
  addedBg: ui.diffAddedBg,
  removedBg: ui.diffRemovedBg,
  contextBg: ui.panelBg,
  addedSignColor: ui.gitAdd,
  removedSignColor: ui.gitDel,
  lineNumberFg: ui.dim,
  lineNumberBg: ui.panelBg,
  addedLineNumberBg: ui.diffAddedBg,
  removedLineNumberBg: ui.diffRemovedBg,
}
