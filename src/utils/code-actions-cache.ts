/**
 * Shared code actions cache module
 * This module provides a single cache instance that is shared between
 * REST API endpoints and MCP tools to ensure consistent request ID handling.
 */

import * as vscode from 'vscode';
import { logger } from './logger';

/**
 * Cached code actions structure
 */
export interface CachedCodeActions {
    actions: vscode.CodeAction[];
    timestamp: number;
    uri: vscode.Uri;
    range: vscode.Range;
}

/**
 * TTL for code actions cache entries (60 seconds)
 */
export const CODE_ACTIONS_TTL = 60000;

/**
 * Shared code actions cache
 * Single instance used by both REST API and MCP tools
 */
export const codeActionsCache = new Map<string, CachedCodeActions>();

/**
 * Generate a unique request ID for code actions
 */
export function generateRequestId(): string {
    return `ca_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Clean up expired cache entries
 */
export function cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of codeActionsCache.entries()) {
        if (now - value.timestamp > CODE_ACTIONS_TTL) {
            codeActionsCache.delete(key);
            logger.info(`[cleanupExpiredCache] Removed expired cache entry: ${key}`);
        }
    }
}

/**
 * Invalidate all cache entries related to a specific file URI
 * This should be called after applying edits to ensure fresh code actions
 */
export function invalidateCacheForUri(uri: vscode.Uri): void {
    const uriString = uri.toString();
    for (const [key, value] of codeActionsCache.entries()) {
        if (value.uri.toString() === uriString) {
            codeActionsCache.delete(key);
            logger.info(`[invalidateCacheForUri] Invalidated cache entry ${key} for uri: ${uriString}`);
        }
    }
}

/**
 * Get cached code actions by request ID
 * Returns undefined if not found or expired
 */
export function getCachedActions(requestId: string): CachedCodeActions | undefined {
    const cached = codeActionsCache.get(requestId);
    
    if (!cached) {
        return undefined;
    }
    
    // Check if expired
    if (Date.now() - cached.timestamp > CODE_ACTIONS_TTL) {
        codeActionsCache.delete(requestId);
        return undefined;
    }
    
    return cached;
}

/**
 * Store code actions in cache with a new request ID
 * @returns The generated request ID
 */
export function cacheCodeActions(
    actions: vscode.CodeAction[],
    uri: vscode.Uri,
    range: vscode.Range
): string {
    const requestId = generateRequestId();
    codeActionsCache.set(requestId, {
        actions,
        timestamp: Date.now(),
        uri,
        range
    });
    return requestId;
}

/**
 * Remove a request from cache
 */
export function removeCachedActions(requestId: string): void {
    codeActionsCache.delete(requestId);
}
