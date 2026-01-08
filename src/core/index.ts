/**
 * Core module - unified capability layer
 * Exports all core functions and types for use by adapters
 */

// Common utilities and types
export * from './common';

// LSP capabilities
export * from './lsp/symbols';
export * from './lsp/refactor';

// Diagnostics
export * from './diagnostics/diagnostics';

// File system operations
export * from './fs/workspace-files';

// Edit operations
export * from './edit/workspace-edit';

// Shell operations
export * from './shell/terminal';
