define([
    'jquery',
    'helpers/i18n',
    'helpers/local-storage',
    'helpers/shortcuts',
    'helpers/api/config',
    'helpers/nwjs/menu-factory'
], function($, i18n, localStorage, shortcuts, config, menuFactory) {
    'use strict';

    // prevent delete (back) behavior
    var defaultKeyBehavior = function() {
        shortcuts.on(['DEL'], function(e) {
            if ('BODY' === e.target.tagName) {
                e.preventDefault();
            }
        });

        if (true === window.FLUX.debug && 'undefined' !== typeof requireNode) {
            shortcuts.on(['ctrl', 'alt', 'd'], function(e) {
                requireNode('nw.gui').Window.get().showDevTools();
            });
        }
    };

    defaultKeyBehavior();

    // detached keyup and keydown event
    window.addEventListener('popstate', function(e) {
        window.GA('send', 'pageview', location.hash);
        shortcuts.disableAll();
        menuFactory.methods.refresh();
        defaultKeyBehavior();
    });

    // listener of all ga event
    $('body').on('click', '[data-ga-event]', function(e) {
        var $self = $(e.currentTarget);

        window.GA('send', 'event', 'button', 'click', $self.data('ga-event'));
    });

    return function(callback) {
        var $body = $('body'),
            hash = location.hash,
            onFinished = function(data) {
                var is_ready = data;

                is_ready = ('true' === is_ready);

                if (true === is_ready && ('' === hash || hash.startsWith('#initialize'))) {
                    location.hash = '#studio/print';
                }
                else if (false === is_ready && false === hash.startsWith('#initialize')) {
                    location.hash = '#';
                }

                callback();
            },
            opt = {
                onError: onFinished
            };

        config(opt).read('printer-is-ready', {
            onFinished: onFinished
        });
    };
});