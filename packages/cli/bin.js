#!/usr/bin/env node
// @agent-creator/cli/bin
// Standalone binary entry point for jcode CLI

import { createCLI } from '@agent-creator/cli';

const cli = createCLI();

(async () => {
  try {
    await cli.initialize(process.cwd());
    
    // Handle command-line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
      console.log('jcode - Local-first AI coding agent CLI');
      console.log('');
      console.log('Usage: jcode <command> [options]');
      console.log('');
      console.log('Available commands:');
      console.log('  file <path>          Read a file\'s contents');
      console.log('  write <file> <text>  Write text to a file');
      console.log('  run <cmd>            Execute a shell command');
      console.log('  list [path]          List directory contents');
      console.log('  search <pattern>     Search code patterns');
      console.log('  git                  Get repository status');
      console.log('  diff                 Show git diff output');
      console.log('  patch <text>         Apply a unified diff patch');
      console.log('  tools                List available tools');
      console.log('  help                 Show this help message');
      return;
    }

    if (args[0] === '--tools' || args[0] === '-t') {
      console.log('[JCode] Available tools via orchestrator:');
      console.log('- runCommand: Execute shell commands');
      console.log('- listDirectory: List files in a directory');
      console.log('- readFile: Read file contents');
      console.log('- writeFile: Write to a file');
      console.log('- getGitStatus: Get git status');
      console.log('- getGitDiff: Show git diff output');
      console.log('- applyPatch: Apply unified diff patches');
      console.log('- searchCode: Search for code patterns');
      return;
    }

    // Execute the command passed as first argument
    const result = await cli.handleCommand(args[0] || 'help', { args });
    
    if (!result.success) {
      process.exit(1);
    }

  } catch (error) {
    console.error('[JCode] Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();