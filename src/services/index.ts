/**
 * Services Index - Backward compatibility layer
 * 
 * This file re-exports from the new core module to maintain backward compatibility
 * for existing code that imports from './services'.
 * 
 * @deprecated Import directly from '../core' for new code.
 */

// Re-export all core functionality
export * from '../core';
