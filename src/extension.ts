// Copyright 2017 The RLS Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

'use strict';

import * as child_process from 'child_process';
import * as fs from 'fs';

import { workspace, ExtensionContext, window, commands } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, NotificationType } from 'vscode-languageclient';

let HIDE_WINDOW_OUTPUT = true;
let LOG_TO_FILE = false;

let spinnerTimer = null;
let spinner = ['|', '/', '-', '\\'];

class Counter {
    count: number;

    constructor() {
        this.count = 0;
    }

    increment() {
        this.count += 1;
    }

    decrementAndGet() {
        this.count -= 1;
        if (this.count < 0) {
            this.count = 0;
        }
        return this.count;
    }
}

export function activate(context: ExtensionContext) {
    window.setStatusBarMessage("RLS analysis: starting up");

    let serverOptions: ServerOptions = () => new Promise<child_process.ChildProcess>((resolve, reject) => {
        let rls_path = process.env.RLS_PATH;
        let rls_root = process.env.RLS_ROOT;

        function spawnServer(...args: string[]): child_process.ChildProcess {
            let childProcess;
            if (rls_path) {
                childProcess = child_process.spawn(rls_path);
            } else if (rls_root) {
                childProcess = child_process.spawn("cargo", ["run", "--release"], { cwd: rls_root });
            } else {
                childProcess = child_process.spawn("rustup", ["run", "nightly", "rls"]);
            }

            childProcess.on('error', err => {
                if ((<any>err).code == "ENOENT") {
                    console.error("Could not spawn rls process:", err.message);
                    window.setStatusBarMessage("RLS Error: Could not spawn process");
                } else {
                    throw err;
                }
            });

            if (LOG_TO_FILE) {
                var logPath = workspace.rootPath + '/rls' + Date.now() + '.log';
                var logStream = fs.createWriteStream(logPath, { flags: 'w+' });
                logStream.on('open', function (f) {
                    childProcess.stderr.addListener("data", function (chunk) {
                        logStream.write(chunk.toString());
                    });
                }).on('error', function (err) {
                    console.error("Couldn't write to " + logPath + " (" + err + ")");
                    logStream.end();
                });
            }

            if (HIDE_WINDOW_OUTPUT) {
                childProcess.stderr.on('data', data => {});
            }

            return childProcess; // Uses stdin/stdout for communication
        }

        resolve(spawnServer())
    });

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for Rust files
        documentSelector: ['rust'],
        synchronize: {
            // Synchronize the setting section 'languageServerExample' to the server
            configurationSection: 'languageServerExample',
            // Notify the server about changes to files contained in the workspace
            //fileEvents: workspace.createFileSystemWatcher('**/*.*')
        }
    };

    // Create the language client and start the client.
    let lc = new LanguageClient('Rust Language Server', serverOptions, clientOptions);

    let runningDiagnostics = new Counter();
    lc.onReady().then(() => {
        lc.onNotification(new NotificationType('rustDocument/diagnosticsBegin'), function(f) {
            runningDiagnostics.increment();

            if (spinnerTimer == null) {
                let state = 0;
                spinnerTimer = setInterval(function() {
                    window.setStatusBarMessage("RLS analysis: working " + spinner[state]);
                    state = (state + 1) % spinner.length;
                }, 100);
            }
        });
        lc.onNotification(new NotificationType('rustDocument/diagnosticsEnd'), function(f) {
            let count = runningDiagnostics.decrementAndGet();
            if (count == 0) {
                clearInterval(spinnerTimer);
                spinnerTimer = null;

                window.setStatusBarMessage("RLS analysis: done");
            }
        });
    });

    let cmdDisposable = commands.registerTextEditorCommand('rls.deglob', (textEditor, edit) => {
        lc.sendRequest('rustWorkspace/deglob', { uri: textEditor.document.uri.toString(), range: textEditor.selection })
            .then((result) => {},
                  (reason) => {
                window.showWarningMessage('deglob command failed: ' + reason);
            });
    });
    context.subscriptions.push(cmdDisposable);

    let disposable = lc.start();
    context.subscriptions.push(disposable);
}
