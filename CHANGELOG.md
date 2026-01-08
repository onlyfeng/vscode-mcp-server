# Change Log

All notable changes to the "vscode-mcp-server" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.0] - 2026-01-08

### Changed
- **Architecture**: Unified MCP tools and REST API to use a single core layer
- **Architecture**: New `src/core/` layer for all business logic (LSP, file operations, diagnostics)
- **Architecture**: New `src/adapters/` layer for protocol-specific translation (MCP, REST)
- **Architecture**: New `src/config/` layer for centralized configuration management
- **Breaking**: `get_symbol_definition_code` now uses definition provider (was hover provider)

### Added
- New MCP tool `get_symbol_definition_code` - Go to definition location (consistent with REST)
- New MCP tool `get_symbol_hover_code` - Get hover info (type signature, documentation)
- New REST endpoint `GET /api/symbols/hover` - Get hover information
- Definition / hover tools are controlled by the `enabledTools.symbol` setting (6 categories total)
- Comprehensive test suite:
  - `src/test/core/` - Unit tests for core layer
  - `src/test/adapters/` - Integration tests for MCP and REST adapters
  - `src/test/e2e/` - MCP vs REST parity tests

### Fixed
- Unified `isDangerousQuickfix` logic between MCP and REST (uses more granular version)
- Removed code duplication - all helper functions now defined once in `core/common.ts`
- Consistent behavior between MCP and REST for all operations

### Removed
- Deleted redundant `src/tools/` directory (migrated to `adapters/mcp/`)
- Deleted redundant `src/services/*.ts` files (migrated to `core/`)

## [0.3.3] - 2025-xx-xx

- Previous stable release

## [Unreleased]

- Initial release
