/** @jsx React.DOM */

var PT = React.PropTypes

var RoleCard = React.createClass({
    propTypes: {
        confirmed: PT.bool.isRequired,
        playerName: PT.string.isRequired,
        onClickConfirm: PT.func.isRequired,
        onClickCancel: PT.func.isRequired,
    },

    render: function() {
        if (this.props.confirmed) {
            return <p>You're a spy!</p>
        } else {
            return <div>
                <p>Are you {this.props.playerName}</p>
                <button 
                    onClick={this.onClickConfirm}>
                    Yes
                </button>
                <button 
                    onClick={this.onClickCancel}>
                    No
                </button>
            </div>
        }
    },

    onClickConfirm: function() {
        this.props.onClickConfirm(this.props.playerName)
    },

    onClickCancel: function() {
        this.props.onClickCancel()
    },
});

module.exports = RoleCard
