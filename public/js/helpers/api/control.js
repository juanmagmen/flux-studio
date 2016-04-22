/**
 * API control
 * Ref: https://github.com/flux3dp/fluxghost/wiki/websocket-control
 */
define([
    'jquery',
    'helpers/websocket',
    'helpers/convertToTypedArray',
    'app/constants/device-constants',
    'helpers/rsa-key'
], function($, Websocket, convertToTypedArray, DeviceConstants, rsaKey) {
    'use strict';

    return function(uuid, opts) {
        opts = opts || {};
        opts.onError = opts.onError || function() {};
        opts.onConnect = opts.onConnect || function() {};

        var timeout = 10000,
            timmer,
            isConnected = false,
            ws = new Websocket({
                method: 'control/' + uuid,
                onMessage: function(data) {
                    switch (data.status) {
                    case 'connecting':
                        opts.onConnect(data);
                        clearTimeout(timmer);
                        timmer = setTimeout(isTimeout, timeout);
                        break;
                    case 'connected':
                        clearTimeout(timmer);
                        opts.onConnect(data);
                        break;
                    default:
                        isConnected = true;
                        events.onMessage(data);
                        break;
                    }
                },
                // onError: opts.onError,
                onError: function(response) {
                    events.onError(response);
                },
                onFatal: function(response) {
                    clearTimeout(timmer);
                    events.onError(response);
                },
                onClose: function(response) {
                    isConnected = false;
                },
                autoReconnect: false
            }),
            lastOrder = '',
            events = {
                onMessage: function() {},
                onError: opts.onError
            },
            genericOptions = function(opts) {
                var emptyFunction = function() {};

                opts = opts || {};
                opts.onStarting = opts.onStarting || function() {};
                opts.onFinished = opts.onFinished || function() {};

                return opts;
            },
            isTimeout = function() {
                var error = {
                    'status': 'error',
                    'error': 'TIMEOUT',
                    'info': 'connection timeoout'
                };
                opts.onError(error);
            };

        ws.send(rsaKey());

        return {
            connection: ws,
            ls: function(path) {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    switch (result.status) {
                        case 'connected':
                            break;
                        case 'ok':
                            d.resolve(result);
                            break;
                        default:
                            break;
                    }
                };
                events.onError = function(result) {
                    d.resolve(result);
                };
                lastOrder = 'file ls';
                ws.send(lastOrder + ' ' + path);

                return d.promise();
            },
            fileInfo: function(path, fileName, opt) {
                opts = genericOptions(opts);
                var d = $.Deferred(),
                    data = [];

                data.push(fileName);
                lastOrder = 'fileinfo';
                ws.send(lastOrder + ' ' + path + '/' + fileName);
                events.onMessage = function(result) {
                    if(result instanceof Blob) {
                        data.push(result);
                    }
                    else if(data.length === 2) {
                        //Play info info..
                        data.push(result);
                    }
                    switch(result.status) {
                        case 'ok':
                            d.resolve(data);
                            break;
                        default:
                            break;
                    }
                };
                events.onError = function(result) {
                    d.resolve(result);
                };

                return d.promise();
            },
            selectFile: function(filename) {
                lastOrder = 'select';
                ws.send(lastOrder + ' ' + filename);
            },
            position: function(opts) {
                opts = genericOptions(opts);

                events.onMessage = function(response) {
                    if ('position' === response.status) {
                        opts.onFinished(response);
                    }
                };

                ws.send('position');
            },
            report: function(opts) {
                opts = genericOptions(opts);

                events.onMessage = function(response) {
                    opts.onFinished(response);
                };

                events.onError = function(response) {
                    opts.onFinished(response);
                };

                ws.send('report');
            },
            upload: function(filesize, print_data, opts, callback) {
                opts = genericOptions(opts);

                var self = this,
                    CHUNK_PKG_SIZE = 4096,
                    length = print_data.length || print_data.size,
                    interrupt,
                    positioning,
                    reporting,
                    uploading,
                    doUpload;

                var step = 0,
                    total = parseInt(filesize / CHUNK_PKG_SIZE);

                interrupt = function(cmd) {
                    if ('start' === lastOrder) {
                        ws.send(cmd);
                    }
                };

                positioning = function() {
                    self.position({
                        onFinished: function(response) {
                            if ('PlayTask' === response.location) {
                                console.log('reporting');
                                reporting();
                            }
                            else {
                                console.log('do upload');
                                doUpload();
                            }
                        }
                    });
                };

                reporting = function() {
                    self.report({
                        onFinished: function(response) {
                            if(typeof(response) === 'string') {
                                try {
                                    response = JSON.parse(response);
                                } catch (variable) {
                                    response.status = 'ERROR';
                                } finally {
                                    response.status = response.status.toUpperCase();
                                }
                            }
                            else {
                                response.status = response.status.toUpperCase();
                            }

                            if (true === response.status.startsWith('COMPLETED')) {
                                self.quit().then(function(data) {
                                    console.log('do upload 1', data);
                                    doUpload();
                                });
                            }
                            else {
                                console.log('do upload 2');
                                doUpload();
                            }
                        }
                    });
                };

                uploading = function(data) {
                    if ('continue' === data.status) {
                        var fileReader, chunk;

                        for (var i = 0; i < length; i += CHUNK_PKG_SIZE) {
                            chunk = print_data.slice(i, i + CHUNK_PKG_SIZE);

                            if (print_data instanceof Array) {
                                chunk = convertToTypedArray(chunk, Uint8Array);
                            }

                            fileReader = new FileReader();

                            fileReader.onloadend = function(e) {
                                callback(step++, total);
                                ws.send(this.result);
                            };

                            fileReader.readAsArrayBuffer(chunk);

                        }

                    }
                    else if ('ok' === data.status) {
                        self.start(opts).then(function() {
                            opts.onFinished(data);
                        });
                    }
                    else if(data.status === 'error') {
                        opts.onError(data);
                    }
                };

                doUpload = function() {
                    events.onMessage = uploading;
                    ws.send(lastOrder + ' application/fcode ' + filesize);
                };

                lastOrder = 'upload';

                events.onMessage = positioning;

                doUpload();

                return {
                    pause: function() {
                        interrupt('pause');
                    },
                    resume: function() {
                        interrupt('resume');
                    },
                    abort: function() {
                        interrupt('abort');
                    }
                };
            },
            uploadToDirectory: function(blob, uploadPath, fileName, callback) {
                var d = $.Deferred(),
                    CHUNK_PKG_SIZE = 4096;

                var step = 0,
                    total = parseInt(blob.size / CHUNK_PKG_SIZE);


                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        d.resolve(result);
                        break;
                    case 'continue':
                        var fileReader,
                            chunk,
                            length = blob.length || blob.size;

                        for (var i = 0; i < length; i += CHUNK_PKG_SIZE) {
                            chunk = blob.slice(i, i + CHUNK_PKG_SIZE);

                            if (blob instanceof Array) {
                                chunk = convertToTypedArray(chunk, Uint8Array);
                            }

                            fileReader = new FileReader();

                            fileReader.onloadend = function(e) {
                                ws.send(this.result);
                                callback(step++, total);
                            };

                            fileReader.readAsArrayBuffer(chunk);
                        }

                        break;
                    default:
                        // TODO: do something?
                        break;
                    }
                };

                events.onError = function(error) {
                    console.log(error);
                };

                fileName = fileName.replace(/ /g, '_');
                var ext = fileName.split('.');
                if(ext[ext.length - 1] === 'fc') {

                    ws.send(`upload application/fcode ${blob.size} ${uploadPath}/${fileName}`);
                }
                else if(ext[ext.length - 1] === 'gcode') {
                    fileName = fileName.split('.');
                    fileName.pop();
                    fileName.push('fc');
                    fileName = fileName.join('.');
                    ws.send(`upload text/gcode ${blob.size} ${uploadPath}/${fileName}`);
                }

                return d.promise();
            },
            getStatus: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                ws.send('position');
                lastOrder = 'status';

                return d.promise();
            },
            abort: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };
                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send('abort');
                lastOrder = 'abort';

                return d.promise();
            },
            start: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send('play start');
                lastOrder = 'play start';

                return d.promise();
            },
            pause: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send('pause');
                lastOrder = 'pause';

                return d.promise();
            },
            resume: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send('resume');
                lastOrder = 'resume';

                return d.promise();
            },
            reset: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                ws.send('kick');
                lastOrder = 'kick';

                return d.promise();
            },
            quitTask: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.reject(result);
                }

                ws.send('task quit');
                lastOrder = 'task quit';

                return d.promise();
            },
            quit: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                }

                ws.send('play quit');
                lastOrder = 'play quit';

                return d.promise();
            },
            getPreview: function() {
                var d       = $.Deferred(),
                    data    = [];

                events.onMessage = function(result) {
                    if(result.status === 'ok') {
                        d.resolve(data);
                    }
                    else {
                        data.push(result);
                    }
                };

                events.onError = function(result) {
                    d.resolve('');
                };

                ws.send('play info');
                lastOrder = 'play info';

                return d.promise();
            },
            select: function(path, fileName) {
                var d = $.Deferred();

                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                if(fileName === '') {
                    ws.send(`select ${path.join('/')}`);
                }
                else {
                    ws.send(`select ${path.join('/')}/${fileName}`);
                }

                return d.promise();
            },
            deleteFile: function(fileNameWithPath) {
                var d = $.Deferred();

                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send(`file rmfile ${fileNameWithPath}`);

                return d.promise();
            },
            downloadFile: function(fileNameWithPath, callbackProgress) {
                var d = $.Deferred(),
                    file = [];

                events.onMessage = function(result) {
                    if(result.status === 'continue') {
                        callbackProgress(result);
                    }
                    else {
                        file.push(result);
                    }

                    if(result instanceof Blob) {
                        d.resolve(file);
                    }
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send(`file download ${fileNameWithPath}`);

                return d.promise();
            },

            /**
             * maintain mode
             * @param {string} type - [LOAD|UNLOAD]
             */
            maintain: function(type) {
                var deferred = $.Deferred(),
                    typeMap = {},
                    args = [
                        'task',
                        'maintain'
                    ],
                    currentTask = 'begining';

                typeMap[DeviceConstants.LOAD_FILAMENT]   = 'load_filament';
                typeMap[DeviceConstants.UNLOAD_FILAMENT] = 'unload_filament';

                events.onMessage = function(result) {
                    if ('ok' === result.status && 'begining' === currentTask) {
                        currentTask = typeMap[type];
                        args = [
                            'maintain',
                            currentTask,
                            0, // extruder id
                            220 // temperature
                        ];
                        setTimeout(
                            function() {
                                ws.send(args.join(' '));
                            },
                            3000
                        );
                    }
                    else if (-1 < ['loading', 'unloading'].indexOf(result.status.toLowerCase())) {
                        deferred.notify(result);
                    }
                    else {
                        deferred.resolve(result);
                    }
                };

                events.onError = function(result) {
                    deferred.reject(result);
                };

                ws.send(args.join(' '));

                return deferred.promise();
            },

            /**
             * update firmware
             * @param {File} file - file
             */
            fwUpdate: function(file) {
                var deferred = $.Deferred(),
                    mimeType = 'binary/flux-firmware',
                    blob = new Blob([file], { type: mimeType }),
                    args = [
                        'update_fw',
                        'binary/flux-firmware',  // mimeType
                        blob.size
                    ];

                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        deferred.resolve(result);
                        break;
                    case 'continue':
                        deferred.notify(result);
                        ws.send(blob);
                        break;
                    case 'uploading':
                        // ignore
                        break;
                    default:
                        deferred.reject(result);
                    }
                };

                events.onError = function(result) {
                    deferred.reject(result);
                };

                ws.send(args.join(' '));

                return deferred.promise();
            },

            /**
             * update toolhead firmware
             * @param {File} file - file
             */
            toolheadUpdate: function(file) {
                var deferred = $.Deferred(),
                    mimeType = 'binary/flux-firmware',
                    blob = new Blob([file], { type: mimeType }),
                    args = [
                        'task',
                        'maintain'
                    ],
                    updateArgs = [
                        'maintain',
                        'update_hbfw',
                        'binary/fireware',
                        blob.size
                    ];

                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        if ('maintain' === result.task) {
                            ws.send(updateArgs.join(' '));
                        }
                        else {
                            deferred.resolve(result);
                        }
                        break;
                    case 'uploading':
                        deferred.notify(result);
                        break;
                    case 'continue':
                        deferred.notify(result);
                        ws.send(blob);
                        break;
                    case 'update_hbfw':
                        deferred.notify(result);
                        break;
                    default:
                        deferred.reject(result);
                    }
                };

                events.onError = function(result) {
                    deferred.reject(result);
                };

                ws.send(args.join(' '));

                return deferred.promise();
            },

            /**
             * fetch toolhead info
             *
             * @return Promise
             */
            headinfo: function() {
                var deferred = $.Deferred(),
                    args = [
                        'task',
                        'maintain'
                    ];

                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        if ('maintain' === result.task) {
                            args = [
                                'maintain',
                                'headinfo'
                            ];

                            // MAGIC delay for 5sec
                            setTimeout(function() {
                                ws.send(args.join(' '));
                            }, 5000);
                        }
                        else {
                            deferred.resolve(result);
                        }
                        break;
                    default:
                        deferred.reject(result);
                    }
                };

                events.onError = function(result) {
                    deferred.reject(result);
                };

                ws.send(args.join(' '));

                return deferred.promise();
            }
        };
    };
});
