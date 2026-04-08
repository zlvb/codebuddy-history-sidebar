import * as vscode from 'vscode';
import { HistoryProvider, SessionItem } from './historyProvider';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;

function log(msg: string) {
    outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function findHistoryDir(): string | undefined {
    const platform = os.platform();
    let basePath: string;
    if (platform === 'win32') {
        basePath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (platform === 'darwin') {
        basePath = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        basePath = path.join(os.homedir(), '.config');
    }

    const historyBase = path.join(basePath, 'CodeBuddy CN', 'User', 'globalStorage',
        'tencent-cloud.coding-copilot', 'genie-history');

    if (!fs.existsSync(historyBase)) { return undefined; }

    const currentCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentCwd) { return undefined; }

    const normalizedCwd = currentCwd.replace(/\\/g, '/').toLowerCase();

    try {
        for (const dir of fs.readdirSync(historyBase, { withFileTypes: true })) {
            if (!dir.isDirectory()) { continue; }
            try {
                let decoded = Buffer.from(dir.name, 'base64').toString('utf-8')
                    .replace(/\0+$/, '').toLowerCase();
                if (normalizedCwd.startsWith(decoded) || decoded.startsWith(normalizedCwd)) {
                    return path.join(historyBase, dir.name);
                }
            } catch { /* skip */ }
        }
    } catch { /* skip */ }
    return undefined;
}

function writeCurrentJson(histDir: string, convId: string): void {
    const currentJsonPath = path.join(histDir, 'current.json');
    fs.writeFileSync(currentJsonPath, JSON.stringify({
        conversationId: convId,
        lastUpdated: new Date().toISOString(),
    }, null, 2));
    log(`Wrote current.json → ${convId}`);
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('CB History');
    const provider = new HistoryProvider();

    const treeView = vscode.window.createTreeView('codebuddyHistoryView', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('codebuddyHistory.refresh', () => provider.refresh())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codebuddyHistory.toggleFilter', () => provider.toggleFilter())
    );

    // 点击条目 → 切换对话
    context.subscriptions.push(
        vscode.commands.registerCommand('codebuddyHistory.openSession', async (item: SessionItem) => {
            if (!item.conversationId) { return; }
            const convId = item.conversationId;
            log(`=== Switch to: ${convId} (${item.label}) ===`);

            // Step 1: 写 current.json
            const histDir = findHistoryDir();
            if (histDir) {
                writeCurrentJson(histDir, convId);
            } else {
                log('History dir not found, falling back to chatHistory');
                await vscode.commands.executeCommand('tencentcloud.codingcopilot.chatHistory');
                return;
            }

            // Step 2: focus chat 面板
            try {
                await vscode.commands.executeCommand('coding-copilot.webviews.chat.focus');
            } catch (e: any) {
                log(`Focus failed: ${e?.message}`);
            }

            await new Promise(r => setTimeout(r, 200));

            // Step 3: 只 reload webview（不重载整个窗口）
            try {
                await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
                log('Webview reloaded');
            } catch (e: any) {
                log(`Webview reload failed: ${e?.message}`);
                // 降级：打开历史面板
                try {
                    await vscode.commands.executeCommand('tencentcloud.codingcopilot.chatHistory');
                    log('Opened history panel as fallback');
                } catch {
                    vscode.window.showErrorMessage('无法切换对话');
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codebuddyHistory.deleteSession', async (item: SessionItem) => {
            if (!item.conversationId) { return; }
            const ok = await vscode.window.showWarningMessage(
                `确认删除 "${item.label}"？`, { modal: true }, '删除'
            );
            if (ok === '删除') {
                try {
                    await vscode.commands.executeCommand('codebuddy.session.delete', item.conversationId);
                } catch { /* ignore */ }
                provider.refresh();
            }
        })
    );

    const interval = setInterval(() => provider.refresh(), 30000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
    context.subscriptions.push(treeView, outputChannel);
}

export function deactivate() {}
