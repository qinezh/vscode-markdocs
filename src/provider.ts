import {
    Event,
    EventEmitter,
    ExtensionContext,
    TextDocument,
    TextDocumentContentProvider,
    ProviderResult,
    Uri,
    window,
    workspace
} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
let fileUrl = require("file-url");
import MarkdownService from './markdownService';
import MarkdownPreviewConfig from'./util/markdownPreviewConfig';
import PreviewConfigManager from './util/previewConfigManager';

export class DocumentContentProvider implements TextDocumentContentProvider {
    private _sourceUri: Uri;
    private _onDidChange = new EventEmitter<Uri>();
    private _waiting = false;
    private _context: ExtensionContext;
    private _extraStyles: Array<Uri> = [];
    private _extraScripts: Array<Uri> = [];
    private _nonce: string;
    private _config: MarkdownPreviewConfig;
    private _initialData;
    private previewConfigurations = new PreviewConfigManager();
    private readonly _yamlHeaderRegex = new RegExp(/<yamlheader.*?>([\s\S]*?)<\/yamlheader>/, 'i');

    public static readonly scheme = 'markdocs';

    constructor(context: ExtensionContext) {
        this._context = context;
    }

    public provideTextDocumentContent(uri: Uri): ProviderResult<string> {
        this._sourceUri = Uri.parse(uri.query);

        let initialLine: number | undefined = undefined;
		const editor = window.activeTextEditor;
		if (editor && editor.document.uri.toString() === this._sourceUri.toString()) {
			initialLine = editor.selection.active.line;
        }
        
        
        this._nonce = new Date().getTime() + '' + new Date().getMilliseconds();
        this._config = this.previewConfigurations.loadAndCacheConfiguration(this._sourceUri);
        this._initialData = {
			previewUri: uri.toString(),
			source: this._sourceUri.toString(),
			line: initialLine,
			scrollPreviewWithEditorSelection: this._config.scrollPreviewWithEditorSelection,
			scrollEditorWithPreview: this._config.scrollEditorWithPreview,
			doubleClickToSwitchToEditor: this._config.doubleClickToSwitchToEditor
        };
        
        const workspaceRoot = workspace.rootPath;

        return workspace.openTextDocument(this._sourceUri)
            .then(document => {
                const content = document.getText();
                const uri = document.uri;

                if (!workspaceRoot) {
                    const filePath = path.basename(document.fileName);
                    const basePath = path.dirname(document.fileName);
                    return this.markupAsync(content, filePath, basePath, uri);
                }

                const basePath = path.dirname(document.fileName);
                let docsetRoot = this.getDocsetRoot(basePath) || workspaceRoot;  
                const filePath = path.relative(docsetRoot,  document.fileName);
                docsetRoot = docsetRoot.replace(/\\/g, "/");

                return this.markupAsync(content, filePath, docsetRoot, uri);
            });
    }

    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    public update(uri: Uri) {
        if (!this._waiting) {
            this._waiting = true;
            setTimeout(() => {
                this._waiting = false;
                this._onDidChange.fire(uri);
            }, 50);
        }
    }

    private async markupAsync(markdown: string, filePath: string, basePath: string, uri: Uri): Promise<string> {
        let body = await MarkdownService.markupAsync(markdown, filePath, basePath);
        body = this.filterYamlHeader(body);
        body = this.fixLinks(body, uri);

        const result = `<!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
            <meta id="vscode-markdown-preview-data" data-settings="${JSON.stringify(this._initialData).replace(/"/g, '&quot;')}">
            ${this.getStyles(this._sourceUri, this._nonce, this._config)}
            <base href="${uri.toString(true)}">
        </head>
        <body>
            ${body}
            ${this.getScripts(this._nonce)}
            <script>hljs.initHighlightingOnLoad();</script>
        </body>
        </html>`;

        return result;
    }

    private filterYamlHeader(body: string): string {
        return body.replace(this._yamlHeaderRegex, "");
    }

    private getDocsetRoot(dir: string): string {
        if (dir && path.dirname(dir) !== dir) {
            let config = path.join(dir, "docfx.json");
            if (fs.existsSync(config)) {
                return dir;
            }

            return this.getDocsetRoot(path.dirname(dir));
        }
        
        return null;
    }

    private getStyles(resource: Uri, nonce: string, config: MarkdownPreviewConfig): string {
        const baseStyles = [
            this.getMediaPath('markdown.css'),
            this.getMediaPath('tomorrow.css'),
            this.getNodeModulePath('highlightjs/styles/tomorrow-night-bright.css'),
            this.getMediaPath('docfx.css')
        ].concat(this._extraStyles.map(resource => resource.toString()));

        return `${baseStyles.map(href => `<link rel="stylesheet" type="text/css" href="${href}">`).join('\n')}
			${this.getSettingsOverrideStyles(nonce, config)}
			${this.computeCustomStyleSheetIncludes(resource, config)}`;
    }

    private getScripts(nonce: string): string {
		const scripts = [
            this.getNodeModulePath('jquery/dist/jquery.min.js'),
            this.getNodeModulePath('highlightjs/highlight.pack.js'),            
            this.getMediaPath('main.js'),            
            this.getMediaPath('docfx.js')
        ].concat(this._extraScripts.map(resource => resource.toString()));
		return scripts
			.map(source => `<script src="${source}" nonce="${nonce}" charset="UTF-8"></script>`)
			.join('\n');
    }
    
    private getSettingsOverrideStyles(nonce: string, config: MarkdownPreviewConfig): string {
		return `<style nonce="${nonce}">
			body {
				${config.fontFamily ? `font-family: ${config.fontFamily};` : ''}
				${isNaN(config.fontSize) ? '' : `font-size: ${config.fontSize}px;`}
				${isNaN(config.lineHeight) ? '' : `line-height: ${config.lineHeight};`}
			}
		</style>`;
    }
    
    private computeCustomStyleSheetIncludes(resource: Uri, config: MarkdownPreviewConfig): string {
		if (config.styles && Array.isArray(config.styles)) {
			return config.styles.map(style => {
				return `<link rel="stylesheet" class="code-user-style" data-source="${style.replace(/"/g, '&quot;')}" href="${this.fixHref(resource, style)}" type="text/css" media="screen">`;
			}).join('\n');
		}
		return '';
	}

    private getMediaPath(mediaFile: string): string {
        return Uri.file(this._context.asAbsolutePath(path.join('media', mediaFile))).toString();
    }

    private getNodeModulePath(file: string): string {
        return Uri.file(this._context.asAbsolutePath(path.join('node_modules', file))).toString();
    }

    public addScript(resource: Uri): void {
		this._extraScripts.push(resource);
	}

    public addStyle(resource: Uri): void {
		this._extraStyles.push(resource);
    }

    private fixLinks(document: string, resource: Uri): string {
        return document.replace(
            new RegExp("((?:src|href)=[\'\"])([^#]*?)([\'\"])", "gmi"), (subString: string, p1: string, p2: string, p3: string): string => {
                return [
                    p1,
                    this.fixHref(resource, p2, false),
                    p3
                ].join("");
            }
        );
    }

    private fixHref(resource: Uri, href: string, basedOnWorkspace: boolean = true): string {
		if (!href) {
			return href;
		}

		// Use href if it is already an URL
		const hrefUri = Uri.parse(href);
		if (['file', 'http', 'https'].indexOf(hrefUri.scheme) >= 0) {
			return hrefUri.toString();
		}

		// Use href as file URI if it is absolute
		if (path.isAbsolute(href)) {
			return Uri.file(href).toString();
		}

		// use a workspace relative path if there is a workspace
		let root = workspace.getWorkspaceFolder(resource);
		if (root && basedOnWorkspace) {
			return Uri.file(path.join(root.uri.fsPath, href)).toString();
		}

        // otherwise look relative to the markdown file
        return href;
	}
}

export function isMarkdownFile(document: TextDocument) {
	return document.languageId === 'markdown'
		&& document.uri.scheme !== DocumentContentProvider.scheme; // prevent processing of own documents
}