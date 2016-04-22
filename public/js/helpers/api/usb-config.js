/**
 * API usb config
 * Ref: https://github.com/flux3dp/fluxghost/wiki/websocket-usb-config
 */
define([
    'jquery',
    'helpers/websocket',
    'helpers/api/config',
    'helpers/rsa-key'
], function($, Websocket, Config, rsaKey) {
    'use strict';

    var ws;

    return function(globalOpts) {
        globalOpts = globalOpts || {};
        globalOpts.onError = globalOpts.onError || function() {};
        globalOpts.onFatal = globalOpts.onFatal || function() {};
        globalOpts.onClose = globalOpts.onClose || function() {};

        var events = {
                onMessage: function() {}
            },
            reorganizeOptions = function(opts) {
                opts = opts || {};
                opts.onSuccess = opts.onSuccess || function() {};
                opts.onError = opts.onError || function() {};

                return opts;
            };

        if ('undefined' === typeof ws) {
            ws = new Websocket({
                method: 'usb-config',
                autoReconnect: false
            });
        }

        ws.onMessage(function(data) {

            events.onMessage(data);

        });

        // singleton object should reset events everytime.
        ws.onError(globalOpts.onError);
        ws.onFatal(globalOpts.onFatal);
        ws.onClose(globalOpts.onClose);

        return {
            connection: ws,
            // list available port
            list: function(opts) {
                opts = reorganizeOptions(opts);

                var self = this,
                    goNext = true,
                    timer,
                    reset = function() {
                        clearInterval(timer);
                        goNext = true;
                    },
                    checkPorts = function(ports) {
                        if (true === goNext) {
                            goNext = false;

                            self.connect(
                                (ports.pop() || ''),
                                {
                                    onSuccess: function(response) {
                                        opts.onSuccess(response);
                                        reset();
                                    },
                                    onError: function(response) {
                                        goNext = true;

                                        if (0 === ports.length) {
                                            opts.onError(response);
                                            reset();
                                        }
                                    }
                                }
                            );
                        }
                    };

                events.onMessage = function(data) {

                    if ('ok' === data.status) {
                        timer = setInterval(function() {
                            checkPorts(data.ports);
                        }, 100);
                    }

                };

                ws.send('list');
            },

            connect: function(port, opts) {
                opts = reorganizeOptions(opts);

                var currentCommand = 'key',
                    args = [
                        currentCommand,
                        rsaKey()
                    ];

                ws.onError(opts.onError);

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        if ('key' === currentCommand) {
                            currentCommand = 'connect';
                            args = [
                                currentCommand,
                                port
                            ];
                            ws.send(args.join(' '));
                        }
                        else {
                            data.port = port;
                            opts.onSuccess(data);
                        }
                    }
                };

                ws.send(args.join(' '));
            },

            getWifiNetwork: function(opts) {
                var strength = {
                    BEST: 'best',
                    GOOD: 'good',
                    POOR: 'poor',
                    BAD: 'bad'
                };

                opts = reorganizeOptions(opts);

                ws.onError(opts.onError);

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        data.items = data.items || [];

                        data.wifi.forEach(function(wifi, i) {
                            wifi.rssi = Math.abs(wifi.rssi || 0);

                            if (75 < wifi.rssi) {
                                data.wifi[i].strength = strength.BEST;
                            }
                            else if (50 < strength) {
                                data.wifi[i].strength = strength.GOOD;
                            }
                            else if (25 < strength) {
                                data.wifi[i].strength = strength.POOR;
                            }
                            else {
                                data.wifi[i].strength = strength.BAD;
                            }

                            data.items.push({
                                security: data.wifi[i].security,
                                ssid: data.wifi[i].ssid,
                                password: ('' !== data.wifi[i].security),
                                rssi: wifi.rssi,
                                strength: wifi.strength
                            });
                        });

                        opts.onSuccess(data);
                    }
                };

                ws.send('scan_wifi');
            },

            setWifiNetwork: function(wifi, password, opts) {
                opts = reorganizeOptions(opts);

                var wifiConfig = {
                        wifi_mode: 'client',
                        ssid: wifi.ssid,
                        security: wifi.security,
                        method: 'dhcp'
                    },
                    args = [
                        'set network'
                    ];

                switch (wifiConfig.security.toUpperCase()) {
                case 'WEP':
                    wifiConfig.wepkey = password;
                    break;
                case 'WPA-PSK':
                case 'WPA2-PSK':
                    wifiConfig.psk = password;
                    break;
                default:
                    // do nothing
                    break;
                }

                args.push(JSON.stringify(wifiConfig));

                ws.onError(opts.onError);

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        opts.onSuccess(data);
                    }
                };

                ws.send(args.join(' '));
            },

            getMachineNetwork: function(deferred) {
                var $deferred = deferred || $.Deferred(),
                    ipv4Pattern = /^\d{1,3}[.]\d{1,3}[.]\d{1,3}[.]\d{1,3}$/g;

                events.onMessage = function(response) {
                    response.ipaddr = response.ipaddr || [];
                    response.ssid = response.ssid || '';

                    if ('ok' === response.status &&
                        0 < response.ipaddr.length &&
                        true === ipv4Pattern.test(response.ipaddr[0]) &&
                        '' !== response.ssid
                    ) {
                        response.action = 'GOOD';
                        $deferred.resolve(response);
                    }
                    else {
                        $deferred.notify({ action: 'TRY_AGAIN' });
                    }
                };

                ws.send('get network');

                ws.onError(function(data) {
                    $deferred.notify({ action: 'ERROR' });
                });

                return $deferred;
            },

            setMachine: function(opts) {
                opts = reorganizeOptions(opts);

                var args;

                ws.onError(opts.onError);

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        opts.onSuccess(data);
                    }
                };

                return {
                    name: function(name, _opts) {
                        opts.onSuccess = _opts.onSuccess || function() {};
                        args = [
                            'set general',
                            JSON.stringify({
                                name: name
                            })
                        ];
                        ws.send(args.join(' '));
                    },
                    password: function(password, _opts) {
                        opts.onSuccess = _opts.onSuccess || function() {};
                        args = [
                            'set password',
                            password
                        ];

                        if ('' !== password) {
                            ws.send(args.join(' '));
                        }
                        else {
                            opts.onSuccess();
                        }
                    }
                };
            },

            setAPMode: function(ssid, opts) {
                opts = reorganizeOptions(opts);

                var args = [
                    'set network',
                    JSON.stringify({
                        ssid: ssid,
                        wifi_mode: 'host',
                        method: 'dhcp'
                    })
                ];

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        opts.onSuccess(data);
                    }
                };

                ws.onError(opts.onError);
                ws.send(args.join(' '));
            },

            auth: function(password, opts) {
                password = password || '';
                opts = reorganizeOptions(opts);

                var args = [
                    'auth'
                ];

                if ('' !== password) {
                    args.push(password);
                }

                events.onMessage = function(data) {
                    if ('ok' === data.status) {
                        opts.onSuccess(data);
                    }
                };

                ws.onError(opts.onError);
                ws.send(args.join(' '));
            },

            close: function() {
                ws.close();
                ws = new Websocket({
                    method: 'usb-config'
                });
            }
        };
    };
});