/**
 * nwjs menu factory
 */
define([
    'jquery',
    'helpers/nwjs/gui',
    'helpers/i18n',
    'app/actions/initialize-machine',
    'html2canvas',
    'plugins/file-saver/file-saver.min',
    'helpers/output-error'
], function(
    $,
    gui,
    i18n,
    initializeMachine,
    html2canvas,
    fileSaver,
    outputError
) {
    'use strict';

    var emptyFunction = function(object) {
            return object || {};
        },
        separator = {
            label: '',
            type: 'separator'
        },
        lang = i18n.get().topmenu,
        menuMap = [],
        menuIndexOffset = ('osx' === window.FLUX.osType ? 0 : 1),
        parentIndex = {
            ABOUT  : 0 - menuIndexOffset,
            FILE   : 1 - menuIndexOffset,
            EDIT   : 2 - menuIndexOffset,
            DEVICE : 3 - menuIndexOffset,
            WINDOW : 4 - menuIndexOffset,
            HELP   : 5 - menuIndexOffset
        },
        newDevice = {
            label: lang.device.new,
            enabled: true,
            onClick: function() {
                location.hash = '#initialize/wifi/connect-machine';
            },
            key: 'n',
            modifiers: 'cmd'
        },
        items = {
            import: {
                label: lang.file.import,
                enabled: true,
                onClick: emptyFunction,
                key: 'i',
                modifiers: 'cmd',
                parent: parentIndex.FILE
            },
            recent: {
                label: lang.file.recent,
                enabled: true,
                onClick: emptyFunction,
                parent: parentIndex.FILE
            },
            execute: {
                label: lang.file.execute,
                enabled: false,
                onClick: emptyFunction,
                parent: parentIndex.FILE
            },
            saveTask: {
                label: lang.file.save_fcode,
                enabled: false,
                onClick: emptyFunction,
                key: 's',
                modifiers: 'cmd',
                parent: parentIndex.FILE
            },
            saveScene: {
                label: lang.file.save_scene,
                enabled: false,
                onClick: emptyFunction,
                parent: parentIndex.FILE
            },
            duplicate: {
                label: lang.edit.duplicate,
                enabled: false,
                onClick: emptyFunction,
                key: 'd',
                modifiers: 'cmd',
                parent: parentIndex.EDIT
            },
            scale: {
                label: lang.edit.scale,
                enabled: false,
                onClick: emptyFunction,
                key: 's',
                modifiers: 'cmd+alt',
                parent: parentIndex.EDIT
            },
            rotate: {
                label: lang.edit.rotate,
                enabled: false,
                onClick: emptyFunction,
                key: 'r',
                modifiers: 'cmd+alt',
                parent: parentIndex.EDIT
            },
            reset: {
                label: lang.edit.reset,
                enabled: false,
                onClick: emptyFunction,
                parent: parentIndex.EDIT
            },
            undo: {
                label: lang.edit.undo,
                enabled: false,
                key: 'Z',
                modifiers: 'cmd',
                onClick: emptyFunction,
                parent: parentIndex.EDIT
            },
            clear: {
                label: lang.edit.clear,
                enabled: false,
                onClick: emptyFunction,
                key: 'x',
                modifiers: 'cmd+shift',
                parent: parentIndex.EDIT
            },
            device: {
                label: lang.device.label,
                enabled: true,
                defaultSubItems: [newDevice, separator],
                subItems: [newDevice, separator],
                parent: parentIndex.DEVICE
            },
            tutorial: {
                label: lang.help.tutorial,
                enabled: true,
                parent: parentIndex.HELP
            }
        },
        defaultDevice = initializeMachine.defaultPrinter.get(),
        defaultDeviceChange = function() {},
        deviceRefreshTimer,
        createDevice,
        createDeviceList,
        aboutSubItems = [{
            label: lang.flux.about,
            enabled: true,
            onClick: function() {
                $.ajax({
                    url: 'package.json',
                    dataType: 'json'
                }).done(function(response) {
                    alert(lang.version + ':' + response.version);
                });
            }
        },
        {
            label: lang.flux.preferences,
            enabled: true,
            onClick: function() {
                location.hash = '#studio/settings';
            }
        },
        separator,
        {
            label: lang.flux.quit,
            enabled: true,
            key: 'q',
            modifiers: 'cmd',
            onClick: function() {
                nw.Window.get().close();
            }
        }],
        subItems;

    function bindMap() {
        menuMap = [];

        if (1 !== menuIndexOffset) {
            menuMap.push({
                label: lang.flux.label,
                subItems: aboutSubItems
            });
        }

        if (true === initializeMachine.hasBeenCompleted()) {
            subItems = [
                items.import,
                separator,
                items.saveTask,
                items.saveScene
            ];

            if (1 === menuIndexOffset) {
                subItems = subItems.concat(aboutSubItems);
            }

            menuMap.push({
                label: lang.file.label,
                subItems: subItems
            },
            {
                label: lang.edit.label,
                subItems: [
                    items.undo,
                    separator,
                    items.duplicate,
                    items.scale,
                    items.rotate,
                    items.reset,
                    separator,
                    items.clear
                ]
            },
            items.device,
            {
                label: lang.window.label,
                subItems: [
                    {
                        label: lang.window.minimize,
                        enabled: true,
                        onClick: function() {
                            gui.Window.get().minimize();
                        },
                        key: 'm',
                        modifiers: 'cmd'
                    },
                    {
                        label: lang.window.fullscreen,
                        enabled: true,
                        onClick: function() {
                            gui.Window.get().maximize();
                        }
                    }
                ]
            });
        }
    
        menuMap.push({
            label: "Laser",
            subItems: [
                {
                    label: "PaperShoot - Front",
                    enabled: true,
                    onClick: function() {
                        $(".laser-studio .laser-object").css("background","url(/img/laser-platform-1.png)");
                        $(".laser-studio .laser-object").css("background-size","100% 100%");
                    }
                },
                {
                    label: "PaperShoot - Back",
                    enabled: true,
                    onClick: function() {
                        $(".laser-studio .laser-object").css("background","url(/img/laser-platform-2.png)");
                        $(".laser-studio .laser-object").css("background-size","100% 100%");
                    }
                }
            ]
            }
        );

        menuMap.push({
            label: lang.help.label,
            subItems: [
                {
                    label: lang.help.help_center,
                    enabled: true,
                    onClick: function() {
                        if (true === window.FLUX.isNW) {
                            nw.Shell.openExternal('https://helpcenter.flux3dp.com/');
                        }
                        else {
                            window.open('https://helpcenter.flux3dp.com/');
                        }
                    }
                },
                {
                    label: lang.help.contact,
                    enabled: true,
                    onClick: function() {
                        if (true === window.FLUX.isNW) {
                            if(i18n.getActiveLang() === 'zh-tw') {
                                nw.Shell.openExternal('http://flux3dp.zendesk.com/hc/zh-tw/requests/new');
                            }
                            else {
                                nw.Shell.openExternal('http://flux3dp.zendesk.com/hc/en-us/requests/new');
                            }
                        }
                        else {
                            window.open('http://flux3dp.com/contact');
                        }
                    }
                },
                items.tutorial,
                {
                    label: lang.help.forum,
                    enabled: true,
                    onClick: function() {
                        if (true === window.FLUX.isNW) {
                            nw.Shell.openExternal('http://forum.flux3dp.com');
                        }
                        else {
                            window.open('http://forum.flux3dp.com');
                        }
                    }
                },
                {
                    label: lang.help.debug,
                    enabled: true,
                    onClick: function() {
                        outputError();
                    }
                }
            ]
        });

        return menuMap;
    }

    menuMap = bindMap();

    return {
        parentIndex: parentIndex,
        all: menuMap,
        items: items,
        refresh: bindMap
    };

});
