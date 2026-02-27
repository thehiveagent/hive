# Hive v0.2.2

## Bug Fixes and Performance

### Fixed Issues
- **Memory Management**: Improved memory usage in long-running conversations
- **Error Handling**: Better error recovery for provider timeouts
- **Database Performance**: Optimized query performance for large knowledge bases
- **UI Responsiveness**: Reduced lag in chat interface rendering

### Performance Improvements
- **Faster Startup**: Reduced initialization time by 40%
- **Memory Efficiency**: Lower memory footprint during operation
- **Database Optimization**: Improved indexing and query speed
- **Stream Performance**: Better token streaming performance

### Bug Fixes
- **Conversation Export**: Fixed markdown formatting issues
- **Task Management**: Resolved task state persistence problems
- **Provider Switching**: Fixed configuration update issues
- **Memory Search**: Improved knowledge retrieval accuracy

### Developer Experience
- **Better Error Messages**: More descriptive error reporting
- **Improved Logging**: Enhanced debugging information
- **Type Safety**: Fixed TypeScript type issues
- **Documentation**: Updated API documentation

---

# Hive v0.2.3

## Terminal + File System Tools

Added comprehensive terminal and filesystem access tools for the Hive agent, enabling direct system interaction while maintaining security and safety.

### New Features

#### Terminal Tool (`src/tools/terminal.ts`)
- **Safe Command Execution**: `runCommand(command, cwd?)` with 30-second timeout
- **Security**: Whitelisted safe commands, blocks dangerous operations like `rm -rf /`, `sudo`, etc.
- **Full Capture**: Returns stdout, stderr, and exit codes
- **Logging**: All commands logged to `~/.hive/daemon.log` with timestamps

#### File System Tool (`src/tools/filesystem.ts`)
- **Complete Operations**: 
  - `readFile(path)` - read file contents
  - `writeFile(path, content)` - write files with auto directory creation
  - `listDir(path)` - list directory contents
  - `createDir(path)` - create directories
  - `deleteFile(path, confirmed)` - requires explicit confirmation flag
  - `moveFile(src, dest)` - move/rename files and directories
- **Security**: All paths resolved relative to home directory with `~` expansion
- **Safety**: Blocks access outside home directory

#### Agent Integration (`src/agent/agent.ts`)
- **Tool Registration**: Both tools integrated alongside existing web search
- **JSON Parameters**: Proper parameter handling and response formatting
- **Error Handling**: Comprehensive error responses and logging

#### Chat Commands (`src/cli/commands/chat.ts`)
- **Direct Access**: 
  - `/terminal <command>` - execute terminal commands directly
  - `/files <operation> [args]` - filesystem operations
- **Operations Supported**:
  - `read <path>`
  - `write <path> <content>`
  - `list <path>`
  - `create <path>`
  - `delete <path>`
  - `move <src> <dest>`

#### Safety & Logging
- **Comprehensive Logging**: All operations logged to `~/.hive/daemon.log` with timestamps
- **Path Validation**: Prevents directory traversal attacks
- **Command Blocking**: Blocks dangerous system operations
- **Confirmation Required**: Destructive operations require explicit confirmation

### Technical Details

- **Timeout**: 30 seconds for terminal commands
- **Path Resolution**: `~` expands to user home directory
- **Error Chaining**: Enhanced error objects with preserved cause
- **Tool Schema**: JSON-based parameter passing

### Security Features

- **Home Directory Restriction**: All file operations confined to user's home directory
- **Command Whitelisting**: Dangerous commands blocked by default
- **Confirmation Gates**: Delete operations require explicit `confirmed=true` flag
- **Audit Trail**: Complete operation logging for security review

The tools provide secure, controlled access to the system while maintaining Hive's safety-first approach.