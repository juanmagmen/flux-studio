define([
    'jquery',
    'react',
    'jsx!widgets/Select',
    'jsx!widgets/Modal',
    'jsx!views/laser/Advanced-Panel',
    'jsx!widgets/Text-Toggle',
    'helpers/api/config'
], function($, React, SelectView, Modal, AdvancedPanel, TextToggle, config) {
    'use strict';

    return React.createClass({
        _advancedSettings: undefined,

        // Public
        getSettings: function() {
            var settings = this._advancedSettings;

            if ('undefined' === typeof settings) {
                settings = JSON.parse(JSON.stringify($(this.refs.material.getDOMNode()).find('option:selected').data('meta')));
            }

            delete settings.material;
            settings.object_height = this.refs.objectHeight.getDOMNode().value;
            settings.power = settings.power / 255;

            return settings;
        },

        // Private
        _getSelectedMaterial: function(value) {
            var props = this.props,
                lang = props.lang,
                selected_material = lang.laser.advanced.form.object_options.options.filter(
                    function(obj) {
                        return value === obj.value;
                    }
                );

            return (0 < selected_material.length ? selected_material[0] : undefined);
        },

        // UI Events
        _toggleAdvancedPanel: function(open) {
            var self = this;

            return function(material_name) {
                material_name = material_name || '';
                self.setState({
                    openAdvancedPanel: open,
                    defaultMaterial: self._getSelectedMaterial(material_name)
                });
            };
        },

        _openAdvancedPanel: function(e) {
            var $material = $(this.refs.material.getDOMNode()),
                selected_value = $material.find('option:selected').val();

            this._toggleAdvancedPanel(true)(selected_value);
        },

        _onAdvanceDone: function(settings) {
            this._advancedSettings = settings;

            this._toggleAdvancedPanel(false)(settings.material);
        },

        _onRunLaser: function() {
            var settings = this.getSettings();

            this.props.onRunLaser(settings);
        },

        _onExport: function() {
            var settings = this.getSettings();

            this.props.onExport(settings);
        },

        _onObjectHeightBlur: function(e) {
            var value = parseFloat(e.currentTarget.value) || 0;
            e.currentTarget.value = value;

            config().write('laser-object-height', value);
        },

        _renderAdvancedPanel: function(lang, default_material) {
            var content = (
                    <AdvancedPanel
                        lang={lang}
                        materials={this.state.materials}
                        defaultMaterial={default_material}
                        onCancel={this._toggleAdvancedPanel(false)}
                        onDone={this._onAdvanceDone}
                        ref="advancedPanel"
                    />
                );

            return (
                true === this.state.openAdvancedPanel ?
                <Modal content={content} onClose={this._toggleAdvancedPanel(false)}/> :
                ''
            );
        },

        _renderObjectHeight: function(lang) {
            return (
                <input ref="objectHeight" className="text-center control" type="number" min="0" max="100" step="0.1" defaultValue="" readOnly={!this.state.isReady}
                    onBlur={this._onObjectHeightBlur}
                />
            )
        },

        _onReady: function() {
            this.setState({
                isReady: true
            });
        },

        componentWillMount: function () {
            var self = this;

            config().read('custom-material', {
                onFinished: function(response) {
                    if ('' !== response) {
                        var data = response,
                            materials = self.state.materials,
                            customIndex = materials.findIndex(function(el) {
                                return el.value === 'custom';
                            });

                        data.label = self.props.lang.laser.custom;

                        if (-1 === customIndex) {
                            materials.forEach(function(el) {
                                el.selected = false;
                            });

                            materials.push(data);

                            self.setState({
                                materials: materials
                            });
                        }
                    }
                }
            });
        },

        render: function() {
            var props = this.props,
                lang = props.lang,
                cx = React.addons.classSet,
                default_material = (
                    this.state.defaultMaterial ||
                    lang.laser.advanced.form.object_options.options.filter(
                        function(obj) {
                            return true === obj.selected;
                        }
                    )[0]
                ),
                advancedPanel = this._renderAdvancedPanel(lang, default_material),
                objectHeight = this._renderObjectHeight(lang);

            default_material = default_material || {};

            return (
                <div className="setup-panel operating-panel">
                    <ul className="main">
                        <li>
                            <label>
                                <span>{lang.laser.advanced.form.object_options.text}</span>
                                <SelectView
                                    className="control"
                                    defaultValue={default_material.value}
                                    ref="material"
                                    options={this.state.materials}
                                />
                            </label>
                        </li>
                        <li>
                            <label>
                                <span>{lang.laser.print_params.object_height.text}</span>
                                {objectHeight}
                                <span>{lang.laser.print_params.object_height.unit}</span>
                            </label>
                        </li>
                        <li data-ga-event="open-laser-advanced-panel" onClick={this._openAdvancedPanel}>
                            {lang.laser.button_advanced}
                        </li>
                    </ul>

                    {advancedPanel}
                </div>
            );
        },

        componentDidMount: function() {
            var self = this,
                objectHeight = self.refs.objectHeight.getDOMNode(),
                opts = {
                    onError: function(response) {
                        objectHeight.value = 3;
                        self._onReady();
                    }
                }

            config(opts).read('laser-object-height', {
                onFinished: function(response) {
                    objectHeight.value = parseFloat(response, 10);
                    self._onReady();
                }
            });
        },

        getDefaultProps: function() {
            return {
                settingMaterial: React.PropTypes.object,
                hasImage: React.PropTypes.bool,
                mode: React.PropTypes.string
            };
        },

        getInitialState: function() {
            var props = this.props,
                lang = props.lang;

            return {
                openAdvancedPanel: false,
                defaultMaterial: undefined,
                isReady: false,
                materials: lang.laser.advanced.form.object_options.options
            };
        }

    });
});