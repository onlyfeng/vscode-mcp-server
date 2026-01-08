import * as vscode from 'vscode';

/**
 * Logger class for MCP Server extension
 * Uses VS Code's OutputChannel for reliable logging across async operations
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel | null = null;
    private disposed: boolean = false;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('MCP Server Extension');
    }

    /**
     * Get the singleton instance of the logger
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Reset the logger instance (useful for testing)
     */
    public static resetInstance(): void {
        if (Logger.instance) {
            Logger.instance.dispose();
        }
        Logger.instance = undefined as unknown as Logger;
    }

    /**
     * Format a message with timestamp
     * @param message The message to format
     * @returns Formatted message with timestamp
     */
    private formatMessage(message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] ${message}`;
    }

    /**
     * Safely write to the output channel
     * @param message The formatted message to write
     */
    private safeAppendLine(message: string): void {
        if (this.disposed || !this.outputChannel) {
            return;
        }
        try {
            this.outputChannel.appendLine(message);
        } catch {
            // Channel may have been closed, silently ignore
            this.disposed = true;
        }
    }

    /**
     * Log an informational message
     * @param message The message to log
     */
    public info(message: string): void {
        this.safeAppendLine(this.formatMessage(`INFO: ${message}`));
    }

    /**
     * Log a warning message
     * @param message The message to log
     */
    public warn(message: string): void {
        this.safeAppendLine(this.formatMessage(`WARN: ${message}`));
    }

    /**
     * Log an error message
     * @param message The message to log
     */
    public error(message: string): void {
        this.safeAppendLine(this.formatMessage(`ERROR: ${message}`));
    }

    /**
     * Log a debug message
     * @param message The message to log
     */
    public debug(message: string): void {
        this.safeAppendLine(this.formatMessage(`DEBUG: ${message}`));
    }

    /**
     * Show the output channel in the VS Code UI
     */
    public showChannel(): void {
        if (this.disposed || !this.outputChannel) {
            return;
        }
        try {
            this.outputChannel.show();
        } catch {
            this.disposed = true;
        }
    }

    /**
     * Dispose of the output channel
     */
    public dispose(): void {
        if (this.outputChannel && !this.disposed) {
            try {
                this.outputChannel.dispose();
            } catch {
                // Ignore disposal errors
            }
        }
        this.outputChannel = null;
        this.disposed = true;
    }
}

// Export a singleton instance
export const logger = Logger.getInstance();
