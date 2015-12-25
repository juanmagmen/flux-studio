/**
 * API slicing
 * Ref: https://github.com/flux3dp/fluxghost/wiki/websocket-slicing
 */
define([
    'helpers/websocket',
    'helpers/convertToTypedArray'
], function(Websocket, convertToTypedArray) {
    'use strict';

    return function(opts) {
        opts = opts || {};
        opts.onError = opts.onError || function() {};

        var ws = new Websocket({
                method: '3dprint-slicing',
                onMessage: function(data) {
                    events.onMessage(data);
                    lastMessage = data;
                },
                onError: function(data) {
                    events.onError(data);
                    lastMessage = data;
                },
                onFatal: function(data) {
                    events.onFatal(data);
                    lastMessage = data;
                },
                onClose: function(message) {
                    lastMessage = message;
                }
            }),
            lastOrder = '',
            lastMessage = '',
            events = {
                onMessage: function() {},
                onError: function() {}
            };

        return {
            connection: ws,
            upload: function(name, file, callback) {
                var d = $.Deferred(),
                    CHUNK_PKG_SIZE = 4096;

                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        d.resolve(result);
                        break;
                    case 'continue':
                        var fileReader,
                            chunk,
                            length = file.length || file.size;

                        var step = 0,
                            total = parseInt((file.length || file.size) / CHUNK_PKG_SIZE);

                        for (var i = 0; i < length; i += CHUNK_PKG_SIZE) {
                            chunk = file.slice(i, i + CHUNK_PKG_SIZE);

                            if (file instanceof Array) {
                                chunk = convertToTypedArray(chunk, Uint8Array);
                            }

                            fileReader = new FileReader();

                            fileReader.onloadend = function(e) {
                                ws.send(this.result);
                            };

                            fileReader.readAsArrayBuffer(chunk);
                            callback(step++, total);
                        }

                        break;
                    default:
                        // TODO: do something?
                        break;
                    }

                }.bind(this);

                ws.send('upload ' + name + ' ' + file.size);
                lastOrder = 'upload';
                return d.promise();
            },
            set: function(name, positionX, positionY, positionZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ) {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };
                var args = [name, positionX, positionY, positionZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ];
                ws.send('set ' + args.join(' '));
                lastOrder = 'set';

                return d.promise();
            },
            delete: function(name, callback) {
                events.onMessage = function(result) {
                    callback(result);
                };
                events.onError = function(result) {
                    callback(result);
                };
                ws.send('delete ' + name);
                lastOrder = 'delete';
            },
            // go does not use deferred because multiple response and instant update
            goG: function(nameArray, callback) {
                events.onMessage = function(result) {
                    callback(result);
                };
                ws.send('go ' + nameArray.join(' ') + ' -g');
                lastOrder = 'go';
            },
            goF: function(nameArray, callback) {
                events.onMessage = function(result) {
                    callback(result);
                };
                ws.send('go ' + nameArray.join(' ') + ' -f');
                lastOrder = 'go';
            },
            setParameter: function(name, value) {
                var d = $.Deferred(),
                    errors = [];
                events.onMessage = function(result) {
                    d.resolve(result, errors);
                };

                events.onError = function(result) {
                    errors.push(result.error);
                }

                if(name === 'advancedSettings' && value !== '') {
                    ws.send(`advanced_setting ${value}`);
                }
                else {
                    ws.send(`set_params ${name} ${value}`);
                }

                lastOrder = 'set_params';

                return d.promise();
            },
            status: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                ws.send('position');
                lastOrder = 'status';

                return d.promise();
            },
            getPath: function() {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    d.resolve(result);
                };

                ws.send('get_path');
                lastOrder = 'get_path';

                return d.promise();
            },
            uploadPreviewImage: function(file) {
                var d = $.Deferred();
                events.onMessage = function(result) {
                    switch (result.status) {
                    case 'ok':
                        d.resolve(result);
                        break;
                    case 'continue':
                        ws.send(file);
                        break;
                    default:
                        // TODO: do something?
                        break;
                    }

                };

                ws.send('upload_image ' + file.size);
                lastOrder = 'upload_image';

                return d.promise();
            },
            duplicate: function(oldName, newName) {
                var d = $.Deferred();

                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                events.onFatal = function(result) {
                    d.resolve(result);
                };

                ws.send(`duplicate ${oldName} ${newName}`);

                return d.promise();
            },
            stop: function() {
                var d = $.Deferred();

                events.onMessage = function(result) {
                    d.resolve(result);
                };

                events.onError = function(result) {
                    d.resolve(result);
                };

                ws.send(`stop`);

                return d.promise();
            },
            send: function(command) {

                events.onMessage = function(result) {
                    console.log(result);
                };

                events.onError = function(result) {
                    console.log(result);
                };

                ws.send(command);

            }
        };
    };
});
