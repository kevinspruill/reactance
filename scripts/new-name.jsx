/** @jsx React.DOM */

var PT = React.PropTypes

var NewName = React.createClass({
    propTypes: {
        onAddName: PT.func,
    },

    getInitialState: function() {
        return {text: ''}
    },

    render: function() {
        return <form onSubmit={this.onSubmit}>
            <input type="text"
                value={this.state.text}
                onChange={this.onChange}
                ></input>
            <button>
                Add {this.state.text}</button>
        </form>
    },

    onChange: function(e) {
        this.setState({text: e.target.value})
    },

    onSubmit: function(e) {
        e.preventDefault()
        this.props.onAddName(this.state.text)
        this.setState({text: ""})
    }
});

module.exports = NewName
