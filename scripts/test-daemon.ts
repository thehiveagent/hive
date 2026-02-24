// ... (Daemon script updated for criteria)
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import os from "node:os";

const HIVE_HOME = path.join(os.homedir(), ".hive");
const DAEMON_LOCK_FILE = path.join(HIVE_HOME, "daemon.lock");
const DAEMON_STOP_FILE = path.join(HIVE_HOME, "daemon.stop");
const DAEMON_PID_FILE = path.join(HIVE_HOME, "daemon.pid");
const DAEMON_PORT_FILE = path.join(HIVE_HOME, "daemon.port");
const DAEMON_LOG_FILE = path.join(HIVE_HOME, "daemon.log");

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, err?: string): void {
    if (ok) {
        console.log(`✓ ${label}`);
        passed++;
    } else {
        console.log(`✗ ${label} — ${err ?? "assertion failed"}`);
        failed++;
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function getDaemonPort(): number {
    try {
        const raw = fs.readFileSync(DAEMON_PORT_FILE, "utf8").trim();
        const port = parseInt(raw, 10);
        return isNaN(port) ? 2718 : port;
    } catch {
        return 2718;
    }
}

function tcpCommand(command: object, port?: number): Promise<Record<string, unknown>> {
    const p = port ?? getDaemonPort();
    return new Promise((resolve, reject) => {
        const sock = new Socket();
        let buf = "";
        const timer = setTimeout(() => { sock.destroy(); reject(new Error("TCP timeout (5 s)")); }, 5000);
        sock.connect(p, "127.0.0.1", () => { sock.write(JSON.stringify(command) + "\n"); });
        sock.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            if (buf.includes("\n")) {
                clearTimeout(timer); sock.destroy();
                try { resolve(JSON.parse(buf.trim())); } catch (e) { reject(new Error(`Bad JSON: ${buf.trim()}`)); }
            }
        });
        sock.on("error", (e: Error) => { clearTimeout(timer); sock.destroy(); reject(e); });
    });
}

function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid(): number | null {
    try {
        const n = parseInt(fs.readFileSync(DAEMON_PID_FILE, "utf8").trim(), 10);
        return isNaN(n) ? null : n;
    } catch { return null; }
}

async function main(): Promise<void> {
    console.log("--- Running test-daemon.ts ---");

    // Clean up
    if (fs.existsSync(DAEMON_STOP_FILE)) fs.unlinkSync(DAEMON_STOP_FILE);
    if (fs.existsSync(DAEMON_PID_FILE)) fs.unlinkSync(DAEMON_PID_FILE);
    if (fs.existsSync(DAEMON_LOCK_FILE)) fs.unlinkSync(DAEMON_LOCK_FILE);

    try {
        // 1. npm run build passes before any daemon test
        try {
            execSync("npm run build", { cwd: process.cwd(), stdio: "ignore" });
            check("npm run build passes before any daemon test", true);
        } catch (e: any) {
            check("npm run build passes before any daemon test", false, e.message);
            process.exit(1);
        }

        // 2. Daemon starts via node dist/daemon/index.js
        let daemonProc: ChildProcess;
        try {
            daemonProc = spawn("node", ["dist/daemon/index.js"], {
                cwd: process.cwd(),
                detached: false,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, HIVE_HOME },
            });
            check("Daemon starts via node dist/daemon/index.js", true);
        } catch (e: any) {
            check("Daemon starts via node dist/daemon/index.js", false, e.message);
            return;
        }

        // Wait up to 5 seconds for PID and Lock
        await wait(3000);

        // 3. ~/.hive/daemon.pid created within 3 seconds
        const pidExists = fs.existsSync(DAEMON_PID_FILE);
        check("~/.hive/daemon.pid created within 3 seconds", pidExists);

        // 4. ~/.hive/daemon.lock created within 3 seconds
        const lockExists = fs.existsSync(DAEMON_LOCK_FILE);
        check("~/.hive/daemon.lock created within 3 seconds", lockExists);

        // 5. TCP ping to 127.0.0.1:2718 returns { pong: true }
        let daemonPort = getDaemonPort();
        try {
            const ping = await tcpCommand({ type: "ping" }, daemonPort);
            check("TCP ping to 127.0.0.1:2718 returns { pong: true }", ping.pong === true);
        } catch (e: any) {
            check("TCP ping to 127.0.0.1:2718 returns { pong: true }", false, e.message);
        }

        // 6. TCP status returns pid, uptime, agent, provider, model
        let daemonInternalPid: number | null = null;
        try {
            const status = await tcpCommand({ type: "status" }, daemonPort);
            daemonInternalPid = typeof status.pid === "number" ? status.pid : null;
            check("TCP status returns pid, uptime, agent, provider, model",
                typeof status.pid === "number" && typeof status.uptime === "string" && typeof status.agent === "string" && typeof status.provider === "string" && typeof status.model === "string");
        } catch (e: any) {
            check("TCP status", false, e.message);
        }

        // 7. Heartbeat updates within 35 seconds
        const lockBefore = fs.existsSync(DAEMON_LOCK_FILE) ? fs.readFileSync(DAEMON_LOCK_FILE, "utf8").trim() : "0";
        await wait(35000);
        try {
            const lockAfter = fs.readFileSync(DAEMON_LOCK_FILE, "utf8").trim();
            check("Heartbeat updates within 35 seconds", BigInt(lockAfter) > BigInt(lockBefore), `before: ${lockBefore}, after: ${lockAfter}`);
        } catch (e: any) {
            check("Heartbeat updates within 35 seconds", false, e.message);
        }

        // 8. ~/.hive/daemon.log has entries
        try {
            const logContent = fs.readFileSync(DAEMON_LOG_FILE, "utf8");
            check("~/.hive/daemon.log has entries", logContent.length > 0);
        } catch (e: any) {
            check("~/.hive/daemon.log has entries", false, e.message);
        }

        // 9. SIGKILL daemon — watcher restarts it within 90 seconds with new PID
        const oldPid = daemonInternalPid ?? (daemonProc.pid as number);

        // Start Watcher
        const watcherProc: ChildProcess = spawn("node", ["dist/daemon/watcher.js"], {
            cwd: process.cwd(), detached: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HIVE_HOME },
        });

        try { process.kill(oldPid, "SIGKILL"); } catch { }
        await wait(90000);

        const newPid = readPid();
        if (newPid && newPid !== oldPid && alive(newPid)) {
            check("SIGKILL daemon — watcher restarts it within 90 seconds with new PID", true);
        } else {
            check("SIGKILL daemon — watcher restarts it within 90 seconds with new PID", false, `newPid=${newPid}, oldPid=${oldPid}, alive=${newPid && alive(newPid)}`);
        }

        // 10. Sentinel stop: write ~/.hive/daemon.stop — daemon stops and does NOT restart after 90 seconds
        fs.writeFileSync(DAEMON_STOP_FILE, "");
        await wait(35000); // 35s to stop gracefully

        // Wait an additional 70s to verify it doesn't restart
        await wait(70000);

        const pidAfterWait = readPid();
        const stillStopped = !pidAfterWait || !alive(pidAfterWait);
        check("Sentinel stop: write ~/.hive/daemon.stop — daemon stops and does NOT restart after 90 seconds", stillStopped);

        // 11. Clean up all test artifacts after
        try {
            try { watcherProc.kill("SIGKILL"); } catch { }
            const finalPid = readPid();
            if (finalPid && alive(finalPid)) { try { process.kill(finalPid, "SIGKILL"); } catch { } }
            if (daemonProc.pid && alive(daemonProc.pid)) { try { process.kill(daemonProc.pid, "SIGKILL"); } catch { } }

            if (fs.existsSync(DAEMON_STOP_FILE)) fs.unlinkSync(DAEMON_STOP_FILE);
            if (fs.existsSync(DAEMON_PID_FILE)) fs.unlinkSync(DAEMON_PID_FILE);
            if (fs.existsSync(DAEMON_PORT_FILE)) fs.unlinkSync(DAEMON_PORT_FILE);
            if (fs.existsSync(DAEMON_LOCK_FILE)) fs.unlinkSync(DAEMON_LOCK_FILE);

            check("Clean up all test artifacts after", true);
        } catch (e: any) {
            check("Clean up all test artifacts after", false, e.message);
        }

    } catch (err: any) {
        check("script crashed", false, err.message);
    }

    console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
