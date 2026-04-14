import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface SessionData {
    conversationId: string;
    title: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    cwd: string;
    userId?: string;
    deletedAt?: number;
}

export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly session: SessionData | null,
        public readonly isGroup: boolean = false,
        public readonly groupLabel?: string
    ) {
        super(
            isGroup ? groupLabel! : (session?.title || '未命名对话'),
            isGroup
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        if (!isGroup && session) {
            this.contextValue = 'session';
            this.tooltip = new vscode.MarkdownString(
                `**${session.title || '未命名'}**\n\n` +
                `📁 \`${session.cwd}\`\n\n` +
                `🕐 ${new Date(session.updatedAt).toLocaleString()}\n\n` +
                `状态: ${session.status}\n\nID: ${session.conversationId}`
            );
            this.description = formatTime(session.updatedAt);
            this.iconPath = new vscode.ThemeIcon(
                session.status === 'Completed' ? 'check' : 'loading~spin'
            );
            this.command = {
                command: 'codebuddyHistory.openSession',
                title: '打开对话',
                arguments: [this],
            };
        }
    }

    get conversationId(): string | undefined {
        return this.session?.conversationId;
    }
}

function formatTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) { return '刚刚'; }
    if (diff < 3600000) { return `${Math.floor(diff / 60000)}分钟前`; }
    if (diff < 86400000) { return `${Math.floor(diff / 3600000)}小时前`; }
    if (diff < 604800000) { return `${Math.floor(diff / 86400000)}天前`; }
    return new Date(ts).toLocaleDateString();
}

function getDateGroup(ts: number): string {
    const now = new Date();
    const date = new Date(ts);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    if (date >= today) { return '今天'; }
    if (date >= yesterday) { return '昨天'; }
    if (date >= weekAgo) { return '最近7天'; }
    return '更早';
}

function normalizeFsPath(input: string): string {
    return input.replace(/\\/g, '/');
}

export class HistoryProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private sessions: SessionData[] = [];
    private loaded = false;
    private dbPath: string;
    private historyBaseDir: string;
    private showAllWorkspaces = false;

    constructor() {
        this.dbPath = this.resolveDbPath();
        this.historyBaseDir = this.resolveHistoryBaseDir();
    }

    getDbPath(): string { return this.dbPath; }

    refresh(): void {
        this.loaded = false;
        this._onDidChangeTreeData.fire(undefined);
    }

    toggleFilter(): void {
        this.showAllWorkspaces = !this.showAllWorkspaces;
        this.refresh();
    }

    hasSession(session: SessionData | null | undefined): boolean {
        if (!session?.conversationId || !session.cwd) {
            return false;
        }
        const cache = new Map<string, Set<string> | null>();
        return this.isSessionStored(session, cache);
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionItem): Promise<SessionItem[]> {
        if (!this.loaded) {
            await this.loadSessions();
            this.loaded = true;
        }
        if (!element) {
            return this.getGroupedSessions();
        }
        if (element.isGroup && element.groupLabel) {
            return this.getSessionsForGroup(element.groupLabel);
        }
        return [];
    }

    private resolveDbPath(): string {
        const platform = os.platform();
        let basePath: string;
        if (platform === 'win32') {
            basePath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        } else if (platform === 'darwin') {
            basePath = path.join(os.homedir(), 'Library', 'Application Support');
        } else {
            basePath = path.join(os.homedir(), '.config');
        }

        for (const name of ['CodeBuddy CN', 'CodeBuddy', 'buddycn']) {
            const p = path.join(basePath, name, 'codebuddy-sessions.vscdb');
            if (fs.existsSync(p)) { return p; }
        }
        return path.join(basePath, 'CodeBuddy CN', 'codebuddy-sessions.vscdb');
    }

    private resolveHistoryBaseDir(): string {
        return path.join(
            path.dirname(this.dbPath),
            'User',
            'globalStorage',
            'tencent-cloud.coding-copilot',
            'genie-history'
        );
    }

    private encodeWorkspacePath(cwd: string): string {
        return Buffer.from(normalizeFsPath(cwd), 'utf8')
            .toString('base64')
            .replace(/[\/=]/g, '_');
    }

    /**
     * Find the actual workspace dir in genie-history.
     * CodeBuddy may truncate the base64-encoded dir name (e.g. to 64 chars),
     * so we fall back to prefix matching when an exact match is not found.
     */
    private resolveWorkspaceDir(cwd: string): string | null {
        const encoded = this.encodeWorkspacePath(cwd);
        const exact = path.join(this.historyBaseDir, encoded);
        if (fs.existsSync(exact)) {
            return exact;
        }
        // Prefix match: CodeBuddy may truncate the base64 dir name
        try {
            const dirs = fs.readdirSync(this.historyBaseDir, { withFileTypes: true });
            for (const entry of dirs) {
                if (entry.isDirectory() && encoded.startsWith(entry.name) && entry.name.length >= 16) {
                    return path.join(this.historyBaseDir, entry.name);
                }
            }
        } catch { /* ignore */ }
        return null;
    }

    private getConversationIdsForWorkspace(
        cwd: string,
        cache: Map<string, Set<string> | null>
    ): Set<string> | null {
        const normalizedCwd = normalizeFsPath(cwd);
        if (cache.has(normalizedCwd)) {
            return cache.get(normalizedCwd) ?? null;
        }

        const wsDir = this.resolveWorkspaceDir(cwd);
        if (!wsDir) {
            cache.set(normalizedCwd, null);
            return null;
        }

        const conversationsDir = path.join(wsDir, 'conversations');
        if (!fs.existsSync(conversationsDir)) {
            cache.set(normalizedCwd, null);
            return null;
        }

        try {
            const conversationIds = new Set(
                fs.readdirSync(conversationsDir, { withFileTypes: true })
                    .filter(entry => entry.isDirectory())
                    .map(entry => entry.name)
            );
            cache.set(normalizedCwd, conversationIds);
            return conversationIds;
        } catch (err) {
            console.error('[CB History] read conversations dir error:', conversationsDir, err);
            cache.set(normalizedCwd, null);
            return null;
        }
    }

    private isSessionStored(
        session: SessionData,
        cache: Map<string, Set<string> | null>
    ): boolean {
        const conversationIds = this.getConversationIdsForWorkspace(session.cwd, cache);
        return !!conversationIds?.has(session.conversationId);
    }

    private filterDeletedSessions(sessions: SessionData[]): SessionData[] {
        const cache = new Map<string, Set<string> | null>();
        const existingSessions = sessions.filter(session => this.isSessionStored(session, cache));
        const deletedCount = sessions.length - existingSessions.length;
        if (deletedCount > 0) {
            console.log(`[CB History] filtered ${deletedCount} deleted sessions`);
        }
        return existingSessions;
    }

    private async loadSessions(): Promise<void> {
        try {
            if (!fs.existsSync(this.dbPath)) {
                this.sessions = [];
                return;
            }

            const initSqlJs = require('sql.js');
            const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
            const SQL = await initSqlJs(
                fs.existsSync(wasmPath) ? { locateFile: () => wasmPath } : undefined
            );
            const buffer = fs.readFileSync(this.dbPath);
            const db = new SQL.Database(buffer);

            const results = db.exec('SELECT value FROM ItemTable WHERE key LIKE "session:%"');
            db.close();

            if (!results.length || !results[0].values.length) {
                this.sessions = [];
                return;
            }

            const allSessions: SessionData[] = [];
            for (const row of results[0].values) {
                try {
                    const data = JSON.parse(row[0] as string) as SessionData;
                    if (data.conversationId && data.createdAt && data.cwd && !data.deletedAt) {
                        allSessions.push(data);
                    }
                } catch { /* skip malformed */ }
            }

            let filtered = this.filterDeletedSessions(allSessions);
            if (!this.showAllWorkspaces) {
                const currentCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (currentCwd) {
                    const normCwd = normalizeFsPath(currentCwd).toLowerCase();
                    const cwdFiltered = filtered.filter(s => {
                        const sCwd = normalizeFsPath(s.cwd || '').toLowerCase();
                        return sCwd === normCwd || sCwd.startsWith(normCwd + '/');
                    });
                    if (cwdFiltered.length > 0) {
                        filtered = cwdFiltered;
                    }
                }
            }

            this.sessions = filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        } catch (err) {
            console.error('[CB History] loadSessions error:', err);
            this.sessions = [];
        }
    }

    private getGroupedSessions(): SessionItem[] {
        if (this.sessions.length === 0) {
            return [new SessionItem(null, true, '暂无历史对话')];
        }

        const groups = new Map<string, SessionData[]>();
        const groupOrder = ['今天', '昨天', '最近7天', '更早'];

        for (const s of this.sessions) {
            const group = getDateGroup(s.updatedAt || s.createdAt);
            if (!groups.has(group)) { groups.set(group, []); }
            groups.get(group)!.push(s);
        }

        return groupOrder
            .filter(g => groups.has(g))
            .map(g => new SessionItem(null, true, `${g} (${groups.get(g)!.length})`));
    }

    private getSessionsForGroup(groupLabel: string): SessionItem[] {
        const label = groupLabel.replace(/\s*\(\d+\)$/, '');
        return this.sessions
            .filter(s => getDateGroup(s.updatedAt || s.createdAt) === label)
            .map(s => new SessionItem(s));
    }
}
