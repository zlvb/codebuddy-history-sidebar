import * as vscode from 'vscode';
import { HistoryProvider, SessionItem } from './historyProvider';

let outputChannel: vscode.OutputChannel;

function log(msg: string) {
    outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
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

    context.subscriptions.push(
        vscode.commands.registerCommand('codebuddyHistory.openSession', async (item: SessionItem) => {
            if (!item.conversationId) { return; }
            if (!provider.hasSession(item.session)) {
                log(`Skip deleted session: ${item.conversationId}`);
                provider.refresh();
                void vscode.window.showWarningMessage('该历史对话已被删除，已从侧边栏移除。');
                return;
            }

            const convId = item.conversationId;
            log(`Switch to: ${convId} (${item.label})`);

            try {
                await vscode.commands.executeCommand(
                    'tencentcloud.codingcopilot.chat.sendMessage',
                    {
                        message: ' ',
                        options: {
                            conversationId: convId,
                            prefillOnly: true,
                        },
                    }
                );
                log(`Switched to ${convId} via sendMessage`);
            } catch (e: any) {
                log(`sendMessage failed: ${e?.message}`);
                vscode.window.showErrorMessage(`切换对话失败: ${e?.message}`);
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
