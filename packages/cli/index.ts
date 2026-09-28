#!/usr/bin/env node
// @agent-creator/cli
// Core jcode command-line interface

import { AgentOrchestrator, createOrchestrator } from '@agent-creator/agent';

interface CliOptions {
  command: string;
  args?: Record<string, any>;
}

/**
 * CLI Command Processor - handles all tool invocations.
 */
export class JCodeCLI {
  private orchestrator: AgentOrchestrator;
  
  constructor() {
    this.orchestrator = createOrchestrator();
  }

  /**
   * Initialize the CLI with workspace context.
   */
  async initialize(workspace: string): Promise<void> {
    await this.orchestrator.initialize(workspace);
    console.log(`[JCode] Initialized in: ${workspace}`);
  }

  /**
   * Execute a tool command.
   */
  async execute(
    command: string, 
    args?: Record<string, any>
  ): Promise<Record<string, any>> {
    
    console.log(`[JCode] Executing: ${command}`);
    
    // Parse arguments and extract workspace path
    const context = args?.workspace || process.cwd();
    const task = this.orchestrator.createTask(
      `Execute "${command}" in ${context}`,
      { 
        workspace: context,
        command
      }
    );

    // Execute the tool via orchestrator
    try {
      const result = await this.orchestrator.executeTool(command, args || {}, task);
      
      console.log(`[JCode] Result for ${command}:`, JSON.stringify(result));
      return result;
    } catch (error) {
      console.error(`[JCode] Error executing ${command}:`, error);
      throw error;
    }
  }

  /**
   * Process a file read operation.
   */
  async readFile(path: string): Promise<Record<string, any>> {
    console.log(`[JCode] Reading file: ${path}`);
    
    // Mock implementation - in real scenario would use fs
    try {
      return await this.execute('read_file', { path });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes('Not found') || message.includes('does not exist')) {
        return {
          callId: '',
          tool: 'read_file',
          success: false,
          error: `File not found: ${path}`
        };
      }
      
      throw error;
    }
  }

  /**
   * Process a file write operation.
   */
  async writeFile(
    path: string, 
    content: string
  ): Promise<Record<string, any>> {
    console.log(`[JCode] Writing file: ${path}`);
    
    return await this.execute('write_file', { path, content });
  }

  /**
   * Execute a shell command.
   */
  async runCommand(args: string): Promise<Record<string, any>> {
    console.log(`[JCode] Running command: ${args}`);
    
    return await this.execute('run_command', { args });
  }

  /**
   * List directory contents.
   */
  async listDirectory(path?: string): Promise<Record<string, any>> {
    const dirPath = path || process.cwd();
    console.log(`[JCode] Listing directory: ${dirPath}`);
    
    return await this.execute('list_directory', { path: dirPath });
  }

  /**
   * Search for code patterns.
   */
  async searchCode(
    query: string, 
    options?: Record<string, any>
  ): Promise<Record<string, any>> {
    console.log(`[JCode] Searching for pattern: ${query}`);
    
    return await this.execute('search_code', { query, ...options });
  }

  /**
   * Get git status.
   */
  async getGitStatus(): Promise<Record<string, any>> {
    console.log('[JCode] Getting git status');
    
    return await this.execute('git_status', {});
  }

  /**
   * Get git diff.
   */
  async getGitDiff(): Promise<Record<string, any>> {
    console.log('[JCode] Getting git diff');
    
    return await this.execute('git_diff', {});
  }

  /**
   * Apply a patch to files.
   */
  async applyPatch(patchText: string): Promise<Record<string, any>> {
    console.log('[JCode] Applying patch...');
    
    return await this.execute('apply_patch', { patchText });
  }

  /**
   * Main CLI entry point.
   */
  async handleCommand(
    command: string, 
    args?: Record<string, any>
  ): Promise<Record<string, any>> {
    
    const commands = {
      file: this.readFile.bind(this),
      write: this.writeFile.bind(this),
      run: this.runCommand.bind(this),
      list: this.listDirectory.bind(this),
      search: this.searchCode.bind(this),
      git: this.getGitStatus.bind(this),
      diff: this.getGitDiff.bind(this),
      patch: this.applyPatch.bind(this)
    };

    if (command in commands) {
      return await commands[command](args);
    } else if (command === 'help' || command === '--help') {
      console.log('Available jcode commands:');
      console.log('  file <path>          - Read a file\'s contents');
      console.log('  write <file> <text>  - Write text to a file');
      console.log('  run <cmd>            - Execute a shell command');
      console.log('  list [path]          - List directory contents');
      console.log('  search <pattern>     - Search code patterns');
      console.log('  git                  - Get repository status');
      console.log('  diff                 - Show git diff');
      console.log('  patch <text>         - Apply a unified diff patch');
      
      return { success: true, help: true };
    } else if (command === 'tools' || command === '--tools') {
      console.log('[JCode] Available tools via orchestrator:');
      console.log('- runCommand: Execute shell commands');
      console.log('- listDirectory: List files in a directory');
      console.log('- readFile: Read file contents');
      console.log('- writeFile: Write to a file');
      console.log('- getGitStatus: Get git status');
      console.log('- getGitDiff: Show git diff output');
      console.log('- applyPatch: Apply unified diff patches');
      console.log('- searchCode: Search for code patterns');
      
      return { success: true, toolsListed: true };
    } else {
      return {
        success: false,
        error: `Unknown command: ${command}. Use --help for usage.`
      };
    }
  }
}

// Export as module and CLI entry point
export const createCLI = (): JCodeCLI => new JCodeCLI();
