/**
 * Terminal - Core shell command execution
 * Handles shell command execution using VS Code terminal shell integration
 */

import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { ServiceResult } from '../common';

// ============================================
// Types
// ============================================

export interface ShellCommandOptions {
    cwd?: string;
    timeout?: number;
}

export interface ShellCommandResult {
    command: string;
    output: string;
}

// ============================================
// Shell Integration Helpers
// ============================================

/**
 * Waits briefly for shell integration to become available
 * @param terminal The terminal to wait for
 * @param timeout Maximum time to wait in milliseconds
 * @returns Promise that resolves to true if shell integration became available
 */
export async function waitForShellIntegration(
    terminal: vscode.Terminal,
    timeout: number = 1000
): Promise<boolean> {
    if (terminal.shellIntegration) {
        return true;
    }

    return new Promise<boolean>(resolve => {
        const timeoutId = setTimeout(() => {
            disposable.dispose();
            resolve(false);
        }, timeout);

        const disposable = vscode.window.onDidChangeTerminalShellIntegration(e => {
            if (e.terminal === terminal && terminal.shellIntegration) {
                clearTimeout(timeoutId);
                disposable.dispose();
                resolve(true);
            }
        });
    });
}

// ============================================
// Command Execution
// ============================================

/**
 * Executes a shell command using terminal shell integration
 * @param terminal The terminal with shell integration
 * @param command The command to execute
 * @param options Execution options (cwd, timeout)
 * @returns Promise that resolves with the command output
 */
export async function executeShellCommand(
    terminal: vscode.Terminal,
    command: string,
    options: ShellCommandOptions = {}
): Promise<ServiceResult<ShellCommandResult>> {
    const { cwd, timeout = 10000 } = options;
    
    logger.info(`[executeShellCommand] Executing: ${command}, cwd: ${cwd || 'default'}, timeout: ${timeout}ms`);
    
    try {
        if (!terminal) {
            return { success: false, error: 'Terminal not available' };
        }
        
        // Check for shell integration
        if (!terminal.shellIntegration) {
            const shellIntegrationAvailable = await waitForShellIntegration(terminal);
            if (!shellIntegrationAvailable) {
                return { success: false, error: 'Shell integration not available in terminal' };
            }
        }
        
        terminal.show();
        
        // Build full command including cd if cwd is specified
        let fullCommand = command;
        if (cwd) {
            if (cwd === '.' || cwd === './') {
                fullCommand = command;
            } else {
                const quotedPath = cwd.includes(' ') ? `"${cwd}"` : cwd;
                fullCommand = `cd ${quotedPath} && ${command}`;
            }
        }
        
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
        });
        
        // Create execution promise
        const executionPromise = async (): Promise<ServiceResult<ShellCommandResult>> => {
            // Execute the command using shell integration API
            const execution = terminal.shellIntegration!.executeCommand(fullCommand);
            
            // Capture output using the stream
            let output = '';
            
            try {
                // Access the read stream
                const outputStream = (execution as any).read();
                for await (const data of outputStream) {
                    output += data;
                }
            } catch (error) {
                return { success: false, error: `Failed to read command output: ${error}` };
            }
            
            return {
                success: true,
                data: { command: fullCommand, output }
            };
        };
        
        // Race between execution and timeout
        return await Promise.race([executionPromise(), timeoutPromise]);
    } catch (error) {
        logger.error(`[executeShellCommand] Error: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
