/**
 * REST API - Backward compatibility layer
 * 
 * This file re-exports from adapters/rest/router.ts for backward compatibility.
 * @deprecated Import directly from '../adapters/rest/router' for new code.
 */

// Re-export the router factory function
export { createRestApiRouter } from '../adapters/rest/router';
