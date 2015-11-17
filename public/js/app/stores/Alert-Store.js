define([
    'app/dispatcher/Alert-Dispatcher',
    'app/constants/Alert-Constants',
    'events',
    'helpers/object-assign'
], function(
    Dispatcher,
    AlertConstants,
    EventEmitter
){

    var NOTIFY_EVENT = 'notify',
        POPUP_EVENT = 'popup',
        NOTIFY_RETRY = 'retry',
        AlertStore;

    AlertStore = Object.assign(EventEmitter.prototype, {

        onNotify(callback) {
            this.on(NOTIFY_EVENT, callback);
        },

        onPopup(callback) {
            this.on(POPUP_EVENT, callback);
        },

        onRetry(callback) {
            this.on(NOTIFY_RETRY, callback);
        },

        removeNotifyListener(callback) {
            this.removeListener(NOTIFY_EVENT, callback);
        },

        removePopupListener(callback) {
            this.removeListener(POPUP_EVENT, callback);
        },

        removeRetryListener(callback) {
            this.removeListener(NOTIFY_RETRY, callback);
        },

        dispatcherIndex: Dispatcher.register(function(payload) {
            var actionType = payload.actionType;
            var action = {

                'SHOW_INFO': function() {
                    AlertStore.emit(NOTIFY_EVENT, AlertConstants.INFO, payload.message);
                },

                'SHOW_WARNING': function() {
                    AlertStore.emit(NOTIFY_EVENT, AlertConstants.WARNING, payload.message);
                },

                'SHOW_ERROR': function() {
                    AlertStore.emit(NOTIFY_EVENT, AlertConstants.ERROR, payload.message);
                },

                'SHOW_POPUP_INFO': function() {
                    AlertStore.emit(POPUP_EVENT, AlertConstants.INFO, payload.id, payload.message);
                },

                'SHOW_POPUP_WARNING': function() {
                    AlertStore.emit(POPUP_EVENT, AlertConstants.WARNING, payload.id, payload.message);
                },

                'SHOW_POPUP_ERROR': function() {
                    AlertStore.emit(POPUP_EVENT, AlertConstants.ERROR, payload.id, payload.message);
                },

                'NOTIFY_RETRY': function() {
                    AlertStore.emit(NOTIFY_RETRY, payload.id);
                }

            };

            action[actionType]();
        })

    });

    return AlertStore;

});