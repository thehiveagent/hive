import { spawn } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const COMMAND_TIMEOUT = 30000; // 30 seconds

// Dangerous commands that should be blocked
const DANGEROUS_COMMANDS = [
  "rm -rf /",
  "sudo rm",
  "sudo chmod",
  "sudo chown",
  "mkfs",
  "dd if=",
  "format",
  "fdisk",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  ":(){ :|:& };:", // fork bomb
  "sudo su",
  "sudo -i",
  "sudo bash",
  "sudo sh",
];

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TerminalTool {
  private logPath: string;

  constructor() {
    const hiveDir = join(homedir(), ".hive");
    if (!existsSync(hiveDir)) {
      mkdir(hiveDir, { recursive: true });
    }
    this.logPath = join(hiveDir, "daemon.log");
  }

  async runCommand(command: string, cwd?: string): Promise<CommandResult> {
    await this.logOperation(`COMMAND: ${command}${cwd ? ` (cwd: ${cwd})` : ""}`);

    // Check for dangerous commands
    if (this.isDangerousCommand(command)) {
      const error = "Command blocked for safety reasons";
      await this.logOperation(`BLOCKED: ${command} - ${error}`);
      return {
        stdout: "",
        stderr: error,
        exitCode: 1,
      };
    }

    return new Promise((resolve) => {
      const [cmd, ...args] = command.split(" ");
      let child;

      try {
        child = spawn(cmd, args, {
          cwd: cwd || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
          timeout: COMMAND_TIMEOUT,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logOperation(`ERROR: ${command} - ${errorMessage}`);
        resolve({
          stdout: "",
          stderr: errorMessage,
          exitCode: 1,
        });
        return;
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
        const timeoutMsg = `Command timed out after ${COMMAND_TIMEOUT / 1000} seconds`;
        this.logOperation(`TIMEOUT: ${command} - ${timeoutMsg}`);
        resolve({
          stdout,
          stderr: timeoutMsg,
          exitCode: -1,
        });
      }, COMMAND_TIMEOUT);

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        const result = {
          stdout,
          stderr,
          exitCode: code || 0,
        };
        this.logOperation(`RESULT: ${command} - exit code: ${result.exitCode}`);
        resolve(result);
      });

      child.on("error", (error) => {
        clearTimeout(timeoutId);
        const errorMessage = error.message;
        this.logOperation(`ERROR: ${command} - ${errorMessage}`);
        resolve({
          stdout,
          stderr: errorMessage,
          exitCode: 1,
        });
      });
    });
  }

  private isDangerousCommand(command: string): boolean {
    const trimmed = command.trim().toLowerCase();
    
    // Check for exact matches
    if (DANGEROUS_COMMANDS.some(dangerous => trimmed.includes(dangerous))) {
      return true;
    }

    // Check for patterns that suggest destructive behavior
    const dangerousPatterns = [
      /rm\s+-rf?\s+\/($|\s)/, // rm -rf /
      /sudo\s+rm\s+-rf?\s+/, // sudo rm -rf
      />\s*\/dev\/null/, // redirecting to /dev/null with sudo
      /dd\s+if=/, // dd commands
      /mkfs/, // filesystem formatting
      /fdisk/, // disk partitioning
      /shutdown\s+/, // shutdown commands
      /reboot/, // reboot commands
      /halt/, // halt commands
      /poweroff/, // poweroff commands
    ];

    return dangerousPatterns.some(pattern => pattern.test(trimmed));
  }

  private async logOperation(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    
    try {
      await writeFile(this.logPath, logEntry, { flag: "a" });
    } catch (error) {
      // Silently fail if we can't write to log
      console.error("Failed to write to daemon log:", error);
    }
  }
}

export const terminalTool = new TerminalTool();