import {
    commands,
    Extension,
    extensions,
    ExtensionContext,
    OutputChannel,
    Range,
    Selection,
    TextEditorRevealType,
    Position,
    Uri,
    ViewColumn,
    workspace,
    window
} from 'vscode';
import * as path from 'path';
import { DocumentContentProvider, isMarkdownFile } from './provider';
import * as util from './util/common';
import { Logger } from "./util/logger";
import { MarkdocsServer } from "./server";

let _channel: OutputChannel = null;
let _server: MarkdocsServer = null;

export async function activate(context: ExtensionContext) {

    const extensionId = 'qezhu.markdocs';
    const extension = extensions.getExtension(extensionId);

    util.setExtensionPath(extension.extensionPath);

    _channel = window.createOutputChannel("markdocs");
    let logger = new Logger(text => _channel.append(text));

    _server = new MarkdocsServer(context);

    let provider = new DocumentContentProvider(context);
    await _server.ensureRuntimeDependencies(extension, _channel, logger);

    await _server.startMarkdocsServerAsync();

    let registration = workspace.registerTextDocumentContentProvider(DocumentContentProvider.scheme, provider);
    
    let disposableSidePreview = commands.registerCommand('markdocs.showPreviewToSide', uri => {
        preview(uri, ViewColumn.Two, provider);
    });
    let disposableStandalonePreview = commands.registerCommand('markdocs.showPreview', uri => {
        preview(uri, ViewColumn.One, provider);
    });
    let disposableDidClick = commands.registerCommand('markdocs.didClick', (uri, line) => {
        click(uri, line);
    });
    let disposableRevealLink = commands.registerCommand('markdocs.revealLine', (uri, line) => {
        reveal(uri, line);
    });

    context.subscriptions.push(
        disposableSidePreview, 
        disposableStandalonePreview, 
        disposableDidClick, 
        disposableRevealLink,
        registration);

    context.subscriptions.push(workspace.onDidChangeTextDocument(event => {
		if (isMarkdownFile(event.document)) {
			const uri = getPreviewUri(event.document.uri);
			provider.update(uri);
		}
    }));

    context.subscriptions.push(workspace.onDidSaveTextDocument(document => {
		if (isMarkdownFile(document)) {
			const uri = getPreviewUri(document.uri);
			provider.update(uri);
		}
    }));

    context.subscriptions.push(window.onDidChangeTextEditorSelection(event => {
		if (isMarkdownFile(event.textEditor.document)) {
			const markdownFile = getPreviewUri(event.textEditor.document.uri);

			commands.executeCommand('_workbench.htmlPreview.postMessage',
				markdownFile,
				{
					line: event.selections[0].active.line
				});
		}
	}));
}

export function deactivate() {
    _server.stopMarkdocsServer();
}

function getPreviewUri(uri: Uri) {
    if (uri.scheme === DocumentContentProvider.scheme) {
        return uri;
    }

    return uri.with({
        scheme: DocumentContentProvider.scheme,
        path: uri.fsPath + ".rendered",
        query: uri.toString()
    });
}

function preview(uri: Uri, viewColumn: number, provider: DocumentContentProvider) {
    if (window.activeTextEditor) {
        uri = uri || window.activeTextEditor.document.uri;
    }

    if (!uri) {
        return;
    }

    const previewUri = getPreviewUri(uri);
    provider.update(previewUri);
    return commands.executeCommand('vscode.previewHtml', previewUri, viewColumn, `view ${path.basename(uri.fsPath)}`);
}

function click(uri: string, line: number) {
    const sourceUri = Uri.parse(decodeURIComponent(uri));
    return workspace.openTextDocument(sourceUri)
        .then(document => window.showTextDocument(document))
        .then(editor =>
            commands.executeCommand('revealLine', { lineNumber: Math.floor(line), at: 'center' })
                .then(() => editor))
        .then(editor => {
            if (editor) {
                editor.selection = new Selection(
                    new Position(Math.floor(line), 0),
                    new Position(Math.floor(line), 0));
            }
        });
}

function reveal(uri: string, line: number) {
    const sourceUri = Uri.parse(decodeURIComponent(uri));

    window.visibleTextEditors
        .filter(editor => isMarkdownFile(editor.document) && editor.document.uri.toString() === sourceUri.toString())
        .forEach(editor => {
            const sourceLine = Math.floor(line);
            const fraction = line - sourceLine;
            const text = editor.document.lineAt(sourceLine).text;
            const start = Math.floor(fraction * text.length);
            editor.revealRange(
                new Range(sourceLine, start, sourceLine + 1, 0),
                TextEditorRevealType.AtTop);
        });
}
