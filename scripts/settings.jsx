/** @jsx React.DOM */

var PT = React.PropTypes
var cx = React.addons.classSet

var Settings = React.createClass({
    propTypes: {
        // Mapping of settings to their values.
        settings: PT.object.isRequired,
        onChangeSettings: PT.func.isRequired,
    },

    render: function() {
        var settingOrder = ['merlin', 'morgana', 'mordered', 'percival', 'oberon']
        var items = settingOrder.map(function(setting) {
            return <Toggle
                key={setting}
                setting={setting}
                value={this.props.settings[setting]}
                onChange={this.onChangeSetting} />
        }.bind(this))
        return <div className="settings">
            <h2>Special Roles</h2>
            {items}
        </div>
    },

    onChangeSetting: function(setting) {
        var changes = {}
        changes[setting] = !this.props.settings[setting]
        this.props.onChangeSettings(changes)
    },
});

var Toggle = React.createClass({
    propTypes: {
        setting: PT.string.isRequired,
        value: PT.bool.isRequired,
        onChange: PT.func.isRequired,
    },

    render: function() {
        return <button
            className={cx({
                'toggle': true,
                'active': this.props.value,
            })}
            onClick={this.onClick}>
            {capitalize(this.props.setting)}
        </button>
    },

    onClick: function() {
        this.props.onChange(this.props.setting)
    },
});

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

module.exports = Settings
