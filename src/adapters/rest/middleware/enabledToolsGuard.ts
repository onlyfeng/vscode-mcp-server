/**
 * Enabled Tools Guard Middleware
 * Checks if a tool category is enabled before allowing access to REST endpoints
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../utils/logger';
import { ToolConfiguration, ToolCategory } from '../../../config';

/**
 * Creates a middleware that checks if a tool category is enabled
 * @param config Tool configuration
 * @param category The category to check
 * @param categoryName Human-readable name for error messages
 */
export function requireToolEnabled(
    config: ToolConfiguration,
    category: ToolCategory,
    categoryName: string
) {
    return (_req: Request, res: Response, next: NextFunction) => {
        if (!config[category]) {
            logger.info(`[REST API] ${categoryName} endpoint blocked by configuration`);
            return res.status(403).json({
                error: `${categoryName} endpoints are disabled by configuration`,
                hint: 'Update vscode-mcp-server.enabledTools setting to enable this feature'
            });
        }
        next();
    };
}
