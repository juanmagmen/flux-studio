define([
    'jquery',
    'react',
    'helpers/i18n',
    'jsx!widgets/Select',
    'css!cssHome/pages/settings'
], function($, React, i18n, SelectView) {
    'use strict';

    return function(args) {
        args = args || {};

        var options = [],
            View = React.createClass({
                render : function() {
                    var lang = this.state.lang;

                    return (
                        <div className="form general">

                            <div className="row-fluid">

                                <div className="span3 no-left-margin">
                                    <label className="font2">
                                        {lang.settings.language}
                                    </label>
                                </div>

                                <div className="span8">
                                    <SelectView id="select-lang" className="font3" options={options}/>
                                </div>

                            </div>

                            <div className="row-fluid">

                                <div className="span3 no-left-margin">
                                    <label className="font2">
                                        {lang.settings.notifications}
                                    </label>
                                </div>

                                <div className="span8">
                                    <select className="font3">
                                        <option>None</option>
                                    </select>
                                </div>

                            </div>
                        </div>
                    )
                },

                getInitialState: function() {
                    return args.state;
                }

            });

        for (var lang_code in args.props.supported_langs) {
            options.push({
                value: lang_code,
                label: args.props.supported_langs[lang_code],
                selected: lang_code === i18n.getActiveLang()
            });
        }

        return View;
    };
});