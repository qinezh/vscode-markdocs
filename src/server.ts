import {
    Extension,
    ExtensionContext,
    OutputChannel,
    workspace,
    window
} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as util from './util/common';
import { Logger } from './util/logger';
import { HttpClient } from './httpClient';
import { ExtensionDownloader } from './util/ExtensionDownloader';

export class MarkdocsServer {
    private _spawn: childProcess.ChildProcess;
    private _started: boolean = false;
    private readonly serverPath;
    private context: ExtensionContext;

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    public ensureRuntimeDependencies(extension: Extension<any>, channel: OutputChannel, logger: Logger): Promise<boolean> {
        return util.installFileExists(util.InstallFileType.Lock)
            .then(exists => {
                if (!exists) {
                    const downloader = new ExtensionDownloader(channel, logger, extension.packageJSON);
                    return downloader.installRuntimeDependencies();
                } else {
                    return true;
                }
            });
    }

    public async startMarkdocsServerAsync(): Promise<void> {
        const hasStarted = await this.hasAlreadyStartAsync();
        if (hasStarted) {
            return;
        }

        const serverPath = this.getServerPath();
        if (!serverPath) {
            window.showErrorMessage(`[Markdocs Error]: Markdocs server can't be found.`);
            return;
        }

        try {
            this._spawn = this.spawn(serverPath, {});
        }
        catch (err) {
            window.showErrorMessage(`[Markdocs Error]: ${err}`);
            return;
        }

        if (!this._spawn.pid) {
            window.showErrorMessage(`[Markdocs Error] Error occurs while spawning markdocs local server.`);
            return;
        }

        this._spawn.stdout.on("data", data => {
            this._started = false;
        });

        this._spawn.stderr.on("data", data => {
            window.showErrorMessage(`[Markdocs Server Error]: ${data.toString()}`);
        });

        await this.ensureMarkdocsServerWorkAsync();
    }

    private async ensureMarkdocsServerWorkAsync(): Promise<void> {
        while (true) {
            try {
                await HttpClient.pingAsync();
                return;
            } catch (Error) {
                await this.sleepAsync(100);
            }
        }
    }

    private async hasAlreadyStartAsync(): Promise<boolean> {
        try {
            await HttpClient.pingAsync();
            return true;
        } catch (Error) {
            return false;
        }
    }

    public stopMarkdocsServer() {
        this._spawn.kill();
    }

    private async sleepAsync(ms: number) {
        return Promise.resolve(resolve => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    }

    private getServerPath() {
        const serverPaths = [
            ".markdocs/MarkdocsService.exe",
            ".markdocs/MarkdocsService"
        ];

        for (let p of serverPaths) {
            p = this.context.asAbsolutePath(p);
            if (fs.existsSync(p)) {
                return p;
            }
        }
    }

    private spawn(command: string, options): childProcess.ChildProcess {
        let file, args;
        if (process.platform === 'win32') {
            file = 'cmd.exe';
            // execute chcp 65001 to make sure console's code page supports UTF8
            // https://github.com/nodejs/node-v0.x-archive/issues/2190
            args = ['/s', '/c', '"chcp 65001 >NUL & ' + command + '"'];
            options = Object.assign({}, options);
            options.windowsVerbatimArguments = true;
        }
        else {
            file = '/bin/sh';
            args = ['-c', command];
        }
        return childProcess.spawn(file, args, options);
    };
}
