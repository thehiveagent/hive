import { readFile, writeFile, readdir, mkdir, unlink, rename, stat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { cwd } from "process";
import { terminalTool } from "./terminal.js";

export class FilesystemTool {
  private homeDir: string;
  private logPath: string;
  private launchCwd: string;
  private allowedPaths: Set<string>;

  constructor() {
    this.homeDir = homedir();
    this.launchCwd = cwd();
    this.allowedPaths = new Set([this.homeDir, this.launchCwd, "/Volumes"]);
    
    const hiveDir = join(this.homeDir, ".hive");
    if (!existsSync(hiveDir)) {
      mkdir(hiveDir, { recursive: true });
    }
    this.logPath = join(hiveDir, "daemon.log");
  }

  // Allow additional paths during session
  allowPath(path: string): void {
    this.allowedPaths.add(resolve(path));
  }

  async readFile(path: string): Promise<string> {
    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`READ: ${path} -> ${resolvedPath}`);

    try {
      const content = await readFile(resolvedPath, "utf-8");
      await this.logOperation(`READ_SUCCESS: ${path} (${content.length} bytes)`);
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`READ_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to read file ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`WRITE: ${path} -> ${resolvedPath} (${content.length} bytes)`);

    try {
      // Ensure parent directory exists
      const parentDir = resolve(resolvedPath, "..");
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
        await this.logOperation(`MKDIR: ${parentDir}`);
      }

      await writeFile(resolvedPath, content, "utf-8");
      await this.logOperation(`WRITE_SUCCESS: ${path}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`WRITE_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to write file ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async listDir(path: string): Promise<string[]> {
    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`LIST: ${path} -> ${resolvedPath}`);

    try {
      const entries = await readdir(resolvedPath, { withFileTypes: true });
      const result = entries.map(entry => entry.name);
      await this.logOperation(`LIST_SUCCESS: ${path} (${result.length} entries)`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`LIST_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to list directory ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async createDir(path: string): Promise<void> {
    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`MKDIR: ${path} -> ${resolvedPath}`);

    try {
      await mkdir(resolvedPath, { recursive: true });
      await this.logOperation(`MKDIR_SUCCESS: ${path}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`MKDIR_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to create directory ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async deleteFile(path: string, confirmed: boolean = false): Promise<void> {
    if (!confirmed) {
      throw new Error(`File deletion requires explicit confirmation. Set confirmed=true to delete ${path}`);
    }

    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`DELETE: ${path} -> ${resolvedPath} (confirmed: ${confirmed})`);

    try {
      // Check if it's a directory
      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        throw new Error(`Cannot delete directory with deleteFile. Use deleteDirectory instead: ${path}`);
      }

      await unlink(resolvedPath);
      await this.logOperation(`DELETE_SUCCESS: ${path}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`DELETE_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to delete file ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async moveFile(src: string, dest: string): Promise<void> {
    const resolvedSrc = this.resolvePath(src);
    const resolvedDest = this.resolvePath(dest);
    await this.logOperation(`MOVE: ${src} -> ${resolvedSrc}, ${dest} -> ${resolvedDest}`);

    try {
      // Ensure destination directory exists
      const destDir = resolve(resolvedDest, "..");
      if (!existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
        await this.logOperation(`MKDIR: ${destDir}`);
      }

      await rename(resolvedSrc, resolvedDest);
      await this.logOperation(`MOVE_SUCCESS: ${src} -> ${dest}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`MOVE_ERROR: ${src} -> ${dest} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to move file ${src} to ${dest}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  async deleteDirectory(path: string, confirmed: boolean = false): Promise<void> {
    if (!confirmed) {
      throw new Error(`Directory deletion requires explicit confirmation. Set confirmed=true to delete ${path}`);
    }

    const resolvedPath = this.resolvePath(path);
    await this.logOperation(`RMDIR: ${path} -> ${resolvedPath} (confirmed: ${confirmed})`);

    try {
      // Use rm command for recursive deletion
      const result = await terminalTool.runCommand(`rm -rf "${resolvedPath}"`);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
      await this.logOperation(`RMDIR_SUCCESS: ${path}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.logOperation(`RMDIR_ERROR: ${path} - ${errorMessage}`);
      const enhancedError = new Error(`Failed to delete directory ${path}: ${errorMessage}`);
      (enhancedError as Error & { cause?: unknown }).cause = error;
      throw enhancedError;
    }
  }

  private resolvePath(path: string): string {
    // Expand ~ to home directory
    const expanded = path.replace(/^~/, this.homeDir);
    
    // Resolve relative paths
    const resolved = resolve(expanded);
    
    // Check if path is within any allowed directory
    const isAllowed = Array.from(this.allowedPaths).some(allowedPath => 
      resolved === allowedPath || resolved.startsWith(allowedPath + "/")
    );
    
    if (!isAllowed) {
      const allowedList = Array.from(this.allowedPaths).join(", ");
      throw new Error(`Access denied: Path ${path} resolves to ${resolved}, which is outside allowed directories: ${allowedList}`);
    }
    
    return resolved;
  }

  private async logOperation(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] FILESYSTEM: ${message}\n`;
    
    try {
      await writeFile(this.logPath, logEntry, { flag: "a" });
    } catch (error) {
      // Silently fail if we can't write to log
      console.error("Failed to write to daemon log:", error);
    }
  }
}

export const filesystemTool = new FilesystemTool();