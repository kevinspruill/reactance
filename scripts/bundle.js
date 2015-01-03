(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Standalone extraction of Backbone.Events, no external dependency required.
 * Degrades nicely when Backone/underscore are already available in the current
 * global context.
 *
 * Note that docs suggest to use underscore's `_.extend()` method to add Events
 * support to some given object. A `mixin()` method has been added to the Events
 * prototype to avoid using underscore for that sole purpose:
 *
 *     var myEventEmitter = BackboneEvents.mixin({});
 *
 * Or for a function constructor:
 *
 *     function MyConstructor(){}
 *     MyConstructor.prototype.foo = function(){}
 *     BackboneEvents.mixin(MyConstructor.prototype);
 *
 * (c) 2009-2013 Jeremy Ashkenas, DocumentCloud Inc.
 * (c) 2013 Nicolas Perriault
 */
/* global exports:true, define, module */
(function() {
  var root = this,
      breaker = {},
      nativeForEach = Array.prototype.forEach,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      slice = Array.prototype.slice,
      idCounter = 0;

  // Returns a partial implementation matching the minimal API subset required
  // by Backbone.Events
  function miniscore() {
    return {
      keys: Object.keys,

      uniqueId: function(prefix) {
        var id = ++idCounter + '';
        return prefix ? prefix + id : id;
      },

      has: function(obj, key) {
        return hasOwnProperty.call(obj, key);
      },

      each: function(obj, iterator, context) {
        if (obj == null) return;
        if (nativeForEach && obj.forEach === nativeForEach) {
          obj.forEach(iterator, context);
        } else if (obj.length === +obj.length) {
          for (var i = 0, l = obj.length; i < l; i++) {
            if (iterator.call(context, obj[i], i, obj) === breaker) return;
          }
        } else {
          for (var key in obj) {
            if (this.has(obj, key)) {
              if (iterator.call(context, obj[key], key, obj) === breaker) return;
            }
          }
        }
      },

      once: function(func) {
        var ran = false, memo;
        return function() {
          if (ran) return memo;
          ran = true;
          memo = func.apply(this, arguments);
          func = null;
          return memo;
        };
      }
    };
  }

  var _ = miniscore(), Events;

  // Backbone.Events
  // ---------------

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }

      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeners = this._listeners;
      if (!listeners) return this;
      var deleteListener = !name && !callback;
      if (typeof name === 'object') callback = this;
      if (obj) (listeners = {})[obj._listenerId] = obj;
      for (var id in listeners) {
        listeners[id].off(name, callback, this);
        if (deleteListener) delete this._listeners[id];
      }
      return this;
    }

  };

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
    }
  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeners = this._listeners || (this._listeners = {});
      var id = obj._listenerId || (obj._listenerId = _.uniqueId('l'));
      listeners[id] = obj;
      if (typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Mixin utility
  Events.mixin = function(proto) {
    var exports = ['on', 'once', 'off', 'trigger', 'stopListening', 'listenTo',
                   'listenToOnce', 'bind', 'unbind'];
    _.each(exports, function(name) {
      proto[name] = this[name];
    }, this);
    return proto;
  };

  // Export Events as BackboneEvents depending on current context
  if (typeof define === "function") {
    define(function() {
      return Events;
    });
  } else if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = Events;
    }
    exports.BackboneEvents = Events;
  } else {
    root.BackboneEvents = Events;
  }
})(this);

},{}],2:[function(require,module,exports){
module.exports = require('./backbone-events-standalone');

},{"./backbone-events-standalone":1}],3:[function(require,module,exports){
"use strict";
module.exports = colorStyleForPlayer;
function colorStyleForPlayer(player) {
  var numColors = 10;
  var offset = 8;
  var mult = 3;
  var colorNum = Math.abs(hashString(player) * mult + offset) % (numColors) + 1;
  return ("namelet-" + colorNum);
}
function getColorFromString(player) {
  var colors = ["#c0392b", "#27ae60", "#3498db", "#9b59b6", "#f1c40f", "#e67e22", "#e74c3c"];
  return colors[hashString(player) % colors.length];
}
function hashString(str) {
  var hash = 0,
      i,
      chr,
      len;
  if (str.length == 0)
    return hash;
  for (i = 0, len = str.length; i < len; i++) {
    chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}


},{}],4:[function(require,module,exports){
"use strict";
var BackboneEvents = require("backbone-events-standalone");
module.exports = Dispatcher;
function Dispatcher() {
  this._eventer = BackboneEvents.mixin({});
}
Dispatcher.prototype.dispatch = function(action, payload) {
  if (_.isString(action)) {
    payload = _.extend({action: action}, payload);
  } else {
    payload = action;
  }
  console.log(("dispatch: " + payload.action));
  this._eventer.trigger('action', payload);
};
Dispatcher.prototype.bake = function(action, field) {
  return function(input) {
    var payload = {action: action};
    if (field != undefined) {
      payload[field] = input;
    }
    this.dispatch(payload);
  }.bind(this);
};
Dispatcher.prototype.onAction = function(callback) {
  this._eventer.on('action', callback);
};
Dispatcher.prototype.offAction = function(callback) {
  this._eventer.off('action', callback);
};


},{"backbone-events-standalone":2}],5:[function(require,module,exports){
"use strict";
var Store = require('./store');
module.exports = GameState;
function GameState(dispatcher) {
  Store.mixin(this);
  this.playerNames = ['Miles', 'Jess', 'Brandon', 'Ciara', 'Chris'];
  this.settings = {
    merlin: true,
    mordred: false,
    percival: false,
    morgana: false,
    oberon: false
  };
  this.roles = null;
  this.disabledReason = null;
  this.updateRoles();
  dispatcher.onAction(function(payload) {
    var actions = GameState.actions;
    if (_.isFunction(actions[payload.action])) {
      actions[payload.action].call(this, payload);
      this.save();
    }
  }.bind(this));
}
var PERSIST_KEYS = ['playerNames', 'settings', 'roles', 'disabledReason'];
GameState.prototype.save = function() {
  var $__0 = this;
  var persist = {};
  PERSIST_KEYS.forEach((function(key) {
    return persist[key] = $__0[key];
  }));
  store.set('store.gamestate', persist);
};
GameState.prototype.load = function() {
  var $__0 = this;
  var persist = store.get('store.gamestate');
  if (persist !== undefined) {
    PERSIST_KEYS.forEach((function(key) {
      return $__0[key] = persist[key];
    }));
  }
  this.updateRoles();
};
GameState.prototype.getRole = function(name) {
  var $__0 = this;
  if (this.roles === null)
    return null;
  var role = _.extend({}, this.roles[name]);
  if (role.spy) {
    role.otherSpies = _.filter(this.getSpies(), (function(theirName) {
      return !$__0.roles[theirName].oberon && name != theirName;
    }));
    if (this.settings.oberon) {
      role.hasOberon = true;
    }
  }
  if (role.merlin) {
    role.spies = _.filter(this.getSpies(), (function(name) {
      return !$__0.roles[name].mordred;
    }));
  }
  if (role.percival) {
    role.merlins = this.getMerlins();
  }
  return role;
};
GameState.prototype.getSpies = function() {
  var $__0 = this;
  return _.filter(this.playerNames, (function(name) {
    return $__0.roles[name].spy;
  }));
};
GameState.prototype.getMerlins = function() {
  var $__0 = this;
  return _.filter(this.playerNames, (function(name) {
    return $__0.roles[name].morgana || $__0.roles[name].merlin;
  }));
};
GameState.prototype.assignRoles = function() {
  var $__0 = this;
  var numPlayers = this.playerNames.length;
  var numSpies = {
    5: 2,
    6: 2,
    7: 3,
    8: 3,
    9: 3,
    10: 4
  }[numPlayers];
  var shuffledNames = _.shuffle(this.playerNames);
  this.roles = {};
  shuffledNames.forEach((function(name, i) {
    $__0.roles[name] = {spy: i < numSpies};
  }));
  var unassignedSpies = shuffledNames.slice(0, numSpies);
  var unassignedResistance = shuffledNames.slice(numSpies);
  if (this.settings.merlin) {
    var merlinName = unassignedResistance[0];
    unassignedResistance.splice(0, 1);
    this.roles[merlinName].merlin = true;
  }
  if (this.settings.morgana) {
    var morganaName = unassignedSpies[0];
    unassignedSpies.splice(0, 1);
    this.roles[morganaName].morgana = true;
  }
  if (this.settings.percival) {
    var percivalName = unassignedResistance[0];
    unassignedResistance.splice(0, 1);
    this.roles[percivalName].percival = true;
  }
  if (this.settings.mordred) {
    var mordredName = unassignedSpies[0];
    unassignedSpies.splice(0, 1);
    this.roles[mordredName].mordred = true;
  }
  if (this.settings.oberon) {
    var oberonName = unassignedSpies[0];
    unassignedSpies.splice(0, 1);
    this.roles[oberonName].oberon = true;
  }
  this.emitChange();
};
GameState.prototype.updateRoles = function(clear) {
  if (clear) {
    this.roles = null;
  }
  if (this.roles !== null)
    return;
  if (this.playerNames.length < 5) {
    this.disabledReason = 'tooFew';
  } else if (this.playerNames.length > 10) {
    this.disabledReason = 'tooMany';
  } else if (this.playerNames.length < 7 && this.settings.mordred && this.settings.morgana && this.settings.oberon) {
    this.disabledReason = 'tooFew';
  } else {
    this.disabledReason = null;
    this.assignRoles();
  }
};
GameState.actions = {};
GameState.actions.addPlayer = function($__1) {
  var name = $__1.name;
  if (!_.contains(this.playerNames, name)) {
    this.playerNames.push(name);
    this.updateRoles(true);
    this.emitChange();
  }
};
GameState.actions.deletePlayer = function($__1) {
  var name = $__1.name;
  this.playerNames = _.without(this.playerNames, name);
  this.updateRoles(true);
  this.emitChange();
};
GameState.actions.changeSettings = function($__1) {
  var settings = $__1.settings;
  _.extend(this.settings, settings);
  this.updateRoles(true);
  this.emitChange();
};
GameState.actions.newRoles = function() {
  this.updateRoles(true);
};


},{"./store":20}],6:[function(require,module,exports){
"use strict";
var Tabs = require('./tabs.jsx');
var SetupPage = require('./setup-page.jsx');
var RolesPage = require('./roles-page.jsx');
var MissionPage = require('./mission-page.jsx');
var Dispatcher = require('./dispatcher');
var UIState = require('./ui-state');
var GameState = require('./game-state');
var MissionState = require('./mission-state');
var store_reset = require('./store-reset');
var dispatcher = new Dispatcher();
var dispatch = dispatcher.dispatch.bind(dispatcher);
var uistate = new UIState(dispatcher);
var gamestate = new GameState(dispatcher);
var missionstate = new MissionState(dispatcher);
store_reset(3);
uistate.load();
gamestate.load();
missionstate.load();
var renderApp = function() {
  var setupPage = SetupPage({
    playerNames: gamestate.playerNames,
    settings: gamestate.settings,
    onAddName: dispatcher.bake('addPlayer', 'name'),
    onDeleteName: dispatcher.bake('deletePlayer', 'name'),
    onChangeSettings: dispatcher.bake('changeSettings', 'settings'),
    onNewRoles: dispatcher.bake('newRoles')
  });
  var rolesPage = RolesPage({
    disabledReason: gamestate.disabledReason,
    playerNames: gamestate.playerNames,
    selectedPlayer: uistate.selectedPlayer,
    selectedRole: gamestate.getRole(uistate.selectedPlayer),
    selectionConfirmed: uistate.selectionConfirmed,
    onClickShow: dispatcher.bake('selectPlayer', 'name'),
    onClickConfirm: dispatcher.bake('confirmPlayer', 'name'),
    onClickCancel: dispatcher.bake('deselectPlayer'),
    onClickOk: dispatcher.bake('deselectPlayer', 'name')
  });
  var missionPage = MissionPage({
    numPlayers: gamestate.playerNames.length,
    passes: missionstate.passes,
    fails: missionstate.fails,
    history: missionstate.history,
    revealed: uistate.missionRevealed,
    onVote: dispatcher.bake('missionVote', 'pass'),
    onReveal: dispatcher.bake('missionReveal'),
    onReset: dispatcher.bake('missionReset')
  });
  React.renderComponent(Tabs({
    activeTab: uistate.tab,
    onChangeTab: dispatcher.bake('changeTab', 'tab'),
    tabs: {
      setup: {
        name: 'Setup',
        content: setupPage
      },
      roles: {
        name: 'Roles',
        content: rolesPage
      },
      mission: {
        name: 'Mission',
        content: missionPage
      }
    }
  }), document.getElementById('app'));
};
renderApp();
uistate.onChange(renderApp);
gamestate.onChange(renderApp);
missionstate.onChange(renderApp);


},{"./dispatcher":4,"./game-state":5,"./mission-page.jsx":8,"./mission-state":9,"./roles-page.jsx":15,"./setup-page.jsx":17,"./store-reset":19,"./tabs.jsx":21,"./ui-state":22}],7:[function(require,module,exports){
/** @jsx React.DOM */

var PT = React.PropTypes
var cx = React.addons.classSet

var LabeledNumber = React.createClass({displayName: 'LabeledNumber',
    propTypes: {
        num: PT.number.isRequired,
        name: PT.string.isRequired,
    },

    render: function() {
        return React.DOM.figure({className: "labeled-number"}, 
            this.props.num, 
            React.DOM.figcaption(null, this.props.name)
        )
    },
});

module.exports = LabeledNumber

},{}],8:[function(require,module,exports){
/** @jsx React.DOM */

var LabeledNumber = require('./labeled-number.jsx')
var PT = React.PropTypes
var cx = React.addons.classSet

var MissionPage = React.createClass({displayName: 'MissionPage',
    propTypes: {
        numPlayers: PT.number.isRequired,
        passes: PT.number.isRequired,
        fails:  PT.number.isRequired,
        history: PT.array.isRequired,
        revealed:  PT.bool.isRequired,
        onVote:  PT.func.isRequired,
        onReset:  PT.func.isRequired,
        onReveal:  PT.func.isRequired,
    },

    render: function() {
        var missionNumbers = this.renderMissionNumbers()
        if (this.props.revealed) {
            var passLabel = this.props.passes === 1 ? "Pass" : "Passes"
            var failLabel = this.props.fails === 1 ? "Fail" : "Fails"

            return React.DOM.div({className: "mission-page revealed"}, 
                missionNumbers, 
                React.DOM.div({className: "vote-holder"}, 
                    LabeledNumber({
                        name: passLabel, 
                        num: this.props.passes}), 
                    LabeledNumber({
                        name: failLabel, 
                        num: this.props.fails})
                ), 
                React.DOM.button({
                    className: "reset", 
                    onClick: this.props.onReset}, 
                    "Reset")
            )
        } else {
            var votes = this.props.passes + this.props.fails
            Math.random()
            var side = Math.random() > 0.5
            return React.DOM.div({className: "mission-page"}, 
                missionNumbers, 
                LabeledNumber({
                    name: "Votes", 
                    num: votes}), 
                this.renderVoteButton(side), 
                this.renderVoteButton(!side), 
                React.DOM.button({
                    className: "reset", 
                    onClick: this.props.onReset}, 
                    "Reset"), 
                React.DOM.div({className: "reveal-container"}, 
                    React.DOM.button({className: "reveal", 
                        onClick: this.props.onReveal}, 
                        "Show Votes")
                )
            )
        }
    },

    renderMissionNumbers: function() {
        var playerCountsMapping = {
            5: ["2", "3", "2", "3", "3"],
            6: ["2", "3", "4", "3", "4"],
            7: ["2", "3", "3", "4*", "4"],
            8: ["3", "4", "4", "5*", "5"],
            9: ["3", "4", "4", "5*", "5"],
            10: ["3", "4", "4", "5*", "5"],
        }
        var playerCounts = playerCountsMapping[this.props.numPlayers]
        var history = this.props.history

        if (playerCounts === undefined) {
            return null
        }

        var digits = playerCounts.map(function(n, i) {
            var played = history.length > i
            var passed = history[i]==0 || (history[i]==1 && playerCounts[i].indexOf("*")!=-1)
            return React.DOM.span({key: i, className: cx({
                'pass': played && passed,
                'fail': played && !passed,
                'current': history.length ===i,
                'num': true,
            })}, playerCounts[i])
        })

        return React.DOM.div({className: "mission-numbers"}, 
            digits
        )
    },

    renderVoteButton: function(pass) {
        var label = pass ? "Pass" : "Fail"
        return React.DOM.div({key: label, className: "vote-container"}, 
            React.DOM.button({
                className: cx({
                    'pass': pass,
                    'fail': !pass,
                    'secret-focus': true,
                }), 
                'data-pass': pass, 
                onClick: this.onVote}, 
                label)
        )
    },

    onVote: function(e) {
        var pass = e.target.dataset.pass === "true"
        this.props.onVote(pass)
    },
});

module.exports = MissionPage

},{"./labeled-number.jsx":7}],9:[function(require,module,exports){
"use strict";
var Store = require('./store');
module.exports = MissionState;
function MissionState(dispatcher) {
  Store.mixin(this);
  this.passes = 0;
  this.fails = 0;
  this.history = [];
  dispatcher.onAction(function(payload) {
    var actions = MissionState.actions;
    if (_.isFunction(actions[payload.action])) {
      actions[payload.action].call(this, payload);
      this.save();
    }
  }.bind(this));
}
var PERSIST_KEYS = ['passes', 'fails', 'history'];
MissionState.prototype.save = function() {
  var $__0 = this;
  var persist = {};
  PERSIST_KEYS.forEach((function(key) {
    return persist[key] = $__0[key];
  }));
  store.set('store.missionstate', persist);
};
MissionState.prototype.load = function() {
  var $__0 = this;
  var persist = store.get('store.missionstate');
  if (persist !== undefined) {
    PERSIST_KEYS.forEach((function(key) {
      return $__0[key] = persist[key];
    }));
  }
};
MissionState.prototype.resetMission = function() {
  this.passes = 0;
  this.fails = 0;
  this.emitChange();
};
MissionState.prototype.resetMissionHistory = function() {
  this.history = [];
  this.resetMission();
};
MissionState.actions = {};
MissionState.actions.missionVote = function($__1) {
  var pass = $__1.pass;
  if (pass) {
    this.passes += 1;
  } else {
    this.fails += 1;
  }
  this.emitChange();
};
MissionState.actions.missionReset = function() {
  this.resetMission();
};
MissionState.actions.addPlayer = function($__1) {
  var name = $__1.name;
  this.resetMissionHistory();
};
MissionState.actions.deletePlayer = function($__1) {
  var name = $__1.name;
  this.resetMissionHistory();
};
MissionState.actions.changeSettings = function($__1) {
  var settings = $__1.settings;
  this.resetMissionHistory();
};
MissionState.actions.newRoles = function() {
  this.resetMissionHistory();
};
MissionState.actions.missionReveal = function() {
  this.history.push(this.fails);
};


},{"./store":20}],10:[function(require,module,exports){
/** @jsx React.DOM */

var colorStyleForPlayer = require('./color.js')
var PT = React.PropTypes
var cx = React.addons.classSet

var Namelet = React.createClass({displayName: 'Namelet',
    propTypes: {
        name: PT.string.isRequired,
    },

    render: function() {
        var name = this.props.name
        var styles = {'namelet': true}
        if (this.props.name !== "") {
            styles[colorStyleForPlayer(name)] = true
        }
        return React.DOM.div({className: cx(styles)}, name[0])
    },

});

module.exports = Namelet

},{"./color.js":3}],11:[function(require,module,exports){
/** @jsx React.DOM */

var Namelet = require('./namelet.jsx')
var PT = React.PropTypes

var NewName = React.createClass({displayName: 'NewName',
    propTypes: {
        onAddName: PT.func,
    },

    getInitialState: function() {
        return {text: ''}
    },

    render: function() {
        return React.DOM.form({className: "new-player", onSubmit: this.onSubmit}, 
            Namelet({name: this.state.text}), 
            React.DOM.input({type: "name", 
                className: "name", 
                value: this.state.text, 
                placeholder: "Another Player", 
                autoCapitalize: "on", 
                onChange: this.onChange
                }), 
            React.DOM.button({className: "new-player"}, 
                "Add")
        )
    },

    onChange: function(e) {
        var name = e.target.value
        name = name.charAt(0).toUpperCase() + name.slice(1),
        this.setState({text: name})
    },

    onSubmit: function(e) {
        e.preventDefault()
        if (this.state.text != "") {
            this.props.onAddName(this.state.text)
            this.setState({text: ""})
        }
    }
});

module.exports = NewName

},{"./namelet.jsx":10}],12:[function(require,module,exports){
/** @jsx React.DOM */

var Namelet = require('./namelet.jsx')
var PT = React.PropTypes

var PlayerChip = React.createClass({displayName: 'PlayerChip',
    propTypes: {
        name: PT.string.isRequired,
    },

    render: function() {
        return React.DOM.div({className: "player-chip"}, 
            Namelet({name: this.props.name}), 
            React.DOM.span({className: "name"}, this.props.name)
        )
    },
});

module.exports = PlayerChip

},{"./namelet.jsx":10}],13:[function(require,module,exports){
/** @jsx React.DOM */

var PT = React.PropTypes

var RoleCard = React.createClass({displayName: 'RoleCard',
    propTypes: {
        playerName: PT.string.isRequired,
        role: PT.object.isRequired,
    },

    render: function() {
        var role = this.props.role
        var contents = null

        var theSpies = role.spies || role.otherSpies || [];
        var spiesText = theSpies.join(', ')
        var spyNoun = theSpies.length == 1 ? "spy" : "spies"
        var spyVerb = theSpies.length == 1 ? "is" : "are"
        var other = role.spy? "other" : ""
        var oberonText = role.hasOberon? React.DOM.span(null, React.DOM.br(null), React.DOM.span({className: "spy"}, "Oberon"), " is hidden from you.") : ''
        var spiesBlock = theSpies.length > 0
                ? React.DOM.p(null, "The ", other, " ", spyNoun, " ", spyVerb, " ", React.DOM.span({className: "spy"}, spiesText), ". ", oberonText)
                : React.DOM.p(null, "You do not see any ", other, " spies.")
        var extraInfo = React.DOM.div(null)
        var description = React.DOM.p(null)

        var name = React.DOM.span({className: "resistance"}, "resistance")

        if (role.spy && !role.oberon) {
            name = React.DOM.span(null, "a ", React.DOM.span({className: "spy"}, "spy"));
            extraInfo = spiesBlock;
        }
        if (role.percival) {
            name = React.DOM.span({className: "resistance"}, "Percival")
            var theMerlins = role.merlins;
            var merlinsText = theMerlins.join(', ');
            var merlinNoun = theMerlins.length == 1 ? 'Merlin' : 'Merlins';
            var merlinVerb = theMerlins.length == 1 ? 'is' : 'are';
            var merlinsBlock = React.DOM.p(null, "The ", merlinNoun, " ", merlinVerb, ": ", merlinsText)
            extraInfo = merlinsBlock;
            description = React.DOM.p(null, "You see ", React.DOM.span({className: "resistance"}, "Merlin"), " and ", React.DOM.span({className: "spy"}, "Morgana"), " both as Merlin.")
        }
        if (role.merlin) {
            name = React.DOM.span({className: "resistance"}, "Merlin");
            extraInfo = spiesBlock;
            description = React.DOM.p(null, "If the spies discover your identity, resistance loses!")
        }
        if (role.mordred) {
            name = React.DOM.span({className: "spy"}, "Mordred")
            description = React.DOM.p(null, "You are invisible to ", React.DOM.span({className: "resistance"}, "Merlin"), ".")
        }
        if (role.morgana) {
            name = React.DOM.span({className: "spy"}, "Morgana")
            description = React.DOM.p(null, "You appear as ", React.DOM.span({className: "resistance"}, "Merlin"), " to ", React.DOM.span({className: "resistance"}, "Percival"), ".")
        }
        if (role.oberon) {
            name = React.DOM.span({className: "spy"}, "Oberon")
            description = React.DOM.p(null, "The other spies cannot see you, and you cannot see them.")
        }

        return React.DOM.div({className: "role-card"}, 
            React.DOM.p(null, "You are ", name, "!"), 
            extraInfo, 
            description
        )

    },

});

var If = React.createClass({displayName: 'If',
    propTypes: {
        cond: PT.bool.isRequired,
        a: PT.component.isRequired,
        b: PT.component.isRequired,
    },

    render: function() {
        if (this.props.cond) {
            return this.props.a
        } else {
            return this.props.b
        }
    },
})

module.exports = RoleCard

},{}],14:[function(require,module,exports){
/** @jsx React.DOM */

var PlayerChip = require('./player-chip.jsx')
var PT = React.PropTypes

var RolePlayerEntry = React.createClass({displayName: 'RolePlayerEntry',
    propTypes: {
        name: PT.string.isRequired,
        confirmed: PT.bool.isRequired,
        selected: PT.bool.isRequired,
        content: PT.component,

        onClickShow: PT.func.isRequired,
        onClickConfirm: PT.func.isRequired,
        onClickBack: PT.func.isRequired,
    },

    render: function() {
        return React.DOM.li({key: this.props.name}, 
            PlayerChip({name: this.props.name}), 
            this.renderButton(), 
            this.props.content
        )
    },

    renderButton: function() {

        var clickHandler = function() {
            this.props.onClickShow(this.props.name)
        }.bind(this);
        var text = "Show role";

        if(this.props.confirmed) {
            clickHandler = function() {
                this.props.onClickBack()
            }.bind(this);
            text = "Hide";
        }
        else if (this.props.selected) {
            clickHandler = function() {
                this.props.onClickConfirm(this.props.name)
            }.bind(this);
            text = "Are you " + this.props.name + "?";
        }

        return React.DOM.button({onClick: clickHandler}, text)
    }

});

module.exports = RolePlayerEntry

},{"./player-chip.jsx":12}],15:[function(require,module,exports){
/** @jsx React.DOM */

var RolePlayerEntry = require('./role-player-entry.jsx')
var RoleCard = require('./role-card.jsx')
var PT = React.PropTypes

var RolesPage = React.createClass({displayName: 'RolesPage',
    propTypes: {
        disabledReason: PT.oneOf(['tooFew', 'tooMany']),
        playerNames: PT.array.isRequired,
        selectedPlayer: PT.string,
        selectedRole: PT.object,
        selectionConfirmed: PT.bool.isRequired,
        onClickShow: PT.func.isRequired,
        onClickConfirm: PT.func.isRequired,
        onClickCancel: PT.func.isRequired,
        onClickOk: PT.func.isRequired,
    },

    render: function() {
        if (this.props.disabledReason !== null) {
            var message = {
                tooFew: "Not enough players. :(",
                tooMany: "Too many players. :(",
            }[this.props.disabledReason]
            return React.DOM.p(null, message)
        }

        var elements = this.props.playerNames.map(function(name) {
            return this.renderEntry(
                name,
                this.props.selectedPlayer === name,
                this.props.selectionConfirmed)
        }.bind(this))

        return React.DOM.ul({className: "player-list"}, 
            elements
        )

    },

    renderEntry: function(name, selected, confirmed) {

        var content = null;
        if (selected && confirmed) {
            content = RoleCard({
                playerName: this.props.selectedPlayer, 
                role: this.props.selectedRole})
        }

        return RolePlayerEntry({
            key: name, 
            name: name, 
            content: content, 
            selected: selected, 
            confirmed: selected && confirmed, 

            onClickShow: this.props.onClickShow, 
            onClickConfirm: this.props.onClickConfirm, 
            onClickBack: this.props.onClickCancel})

    },
});

module.exports = RolesPage

},{"./role-card.jsx":13,"./role-player-entry.jsx":14}],16:[function(require,module,exports){
/** @jsx React.DOM */

var PT = React.PropTypes
var cx = React.addons.classSet

var Settings = React.createClass({displayName: 'Settings',
    propTypes: {
        // Mapping of settings to their values.
        settings: PT.object.isRequired,
        onChangeSettings: PT.func.isRequired,
    },

    render: function() {
        var settingOrder = ['morgana', 'mordred', 'oberon', 'merlin', 'percival']
        var items = settingOrder.map(function(setting) {
            return React.DOM.li({key: setting}, Toggle({
                setting: setting, 
                value: this.props.settings[setting], 
                onChange: this.onChangeSetting}))
        }.bind(this))
        return React.DOM.div({className: "settings"}, 
            React.DOM.h2(null, "Special Roles"), 
            React.DOM.ul(null, items)
        )
    },

    onChangeSetting: function(setting) {
        var changes = {}
        changes[setting] = !this.props.settings[setting]
        this.props.onChangeSettings(changes)
    },
});

var Toggle = React.createClass({displayName: 'Toggle',
    propTypes: {
        setting: PT.string.isRequired,
        value: PT.bool.isRequired,
        onChange: PT.func.isRequired,
    },

    render: function() {
        return React.DOM.button({
            className: cx({
                'toggle': true,
                'active': this.props.value,
            }), 
            onClick: this.onClick}, 
            capitalize(this.props.setting)
        )
    },

    onClick: function() {
        this.props.onChange(this.props.setting)
    },
});

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

module.exports = Settings

},{}],17:[function(require,module,exports){
/** @jsx React.DOM */

var SetupPlayerList = require('./setup-player-list.jsx')
var Settings = require('./settings.jsx')
var PT = React.PropTypes

var SetupPage = React.createClass({displayName: 'SetupPage',
    propTypes: {
        playerNames: PT.array.isRequired,
        // Mapping of settings to their values.
        settings: PT.object.isRequired,
        onAddName: PT.func.isRequired,
        onDeleteName: PT.func.isRequired,
        onChangeSettings: PT.func.isRequired,
        onNewRoles: PT.func.isRequired,
    },

    render: function() {
        return React.DOM.div(null, 
            SetupPlayerList({
                playerNames: this.props.playerNames, 
                onAddName: this.props.onAddName, 
                onDeleteName: this.props.onDeleteName}), 
            Settings({
                settings: this.props.settings, 
                onChangeSettings: this.props.onChangeSettings}), 
            React.DOM.button({className: "new-game", 
                onClick: this.props.onNewRoles}, "New Game")
        )
    },
});

module.exports = SetupPage

},{"./settings.jsx":16,"./setup-player-list.jsx":18}],18:[function(require,module,exports){
/** @jsx React.DOM */

var NewName = require('./new-name.jsx')
var PlayerChip = require('./player-chip.jsx')
var PT = React.PropTypes

var SetupPlayerList = React.createClass({displayName: 'SetupPlayerList',
    propTypes: {
        playerNames: PT.array.isRequired,
        onDeleteName: PT.func.isRequired,
        onAddName: PT.func.isRequired,
    },

    render: function() {
        var elements = this.props.playerNames.map(
            this.renderEntry)

        return React.DOM.div(null, React.DOM.h2(null, "Players"), 
            React.DOM.ul({className: "player-list"}, 
                elements, 
                React.DOM.li(null, 
                    NewName({onAddName: this.props.onAddName})
                )
            )
        )
    },

    renderEntry: function(name) {
        var onClick = function() {
            this.props.onDeleteName(name);
        }.bind(this);

        return React.DOM.li({key: name}, 
            PlayerChip({name: name}), 
            React.DOM.button({className: "delete", 
                onClick: onClick}
            )
        )
    },
});

module.exports = SetupPlayerList

},{"./new-name.jsx":11,"./player-chip.jsx":12}],19:[function(require,module,exports){
"use strict";
module.exports = store_reset;
function store_reset(version) {
  var stored = store.get('STORE_DB_VERSION');
  if (stored === version) {
    return;
  } else {
    store.clear();
    store.set('STORE_DB_VERSION', version);
  }
}


},{}],20:[function(require,module,exports){
"use strict";
var BackboneEvents = require("backbone-events-standalone");
module.exports = Store;
function Store() {
  this._eventer = BackboneEvents.mixin({});
  this._emitChangeBatcher = null;
}
Store.prototype.onChange = function(callback) {
  this._eventer.on('change', callback);
};
Store.prototype.offChange = function(callback) {
  this._eventer.off('change', callback);
};
Store.prototype.emitChange = function() {
  if (this._emitChangeBatcher === null) {
    this._emitChangeBatcher = setTimeout(function() {
      this._eventer.trigger('change');
      this._emitChangeBatcher = null;
    }.bind(this), 10);
  }
};
Store.mixin = function(obj) {
  var store = new Store();
  obj.onChange = store.onChange.bind(store);
  obj.offChange = store.offChange.bind(store);
  obj.emitChange = store.emitChange.bind(store);
};


},{"backbone-events-standalone":2}],21:[function(require,module,exports){
/** @jsx React.DOM */

var PT = React.PropTypes
var cx = React.addons.classSet

var Tabs = React.createClass({displayName: 'Tabs',
    propTypes: {
        activeTab: PT.string.isRequired,
        onChangeTab: PT.func.isRequired,
        tabs: PT.object.isRequired,
    },

    render: function() {
        return React.DOM.div(null, 
            React.DOM.nav(null, 
            this.renderButtons()
            ), 
            React.DOM.div({className: "tab-contents"}, 
            this.props.tabs[this.props.activeTab].content
            )
        )
    },

    renderButtons: function() {
        return _.map(this.props.tabs, function(val, name) {
            return React.DOM.a({
                className: cx({
                    'active': this.props.activeTab === name,
                }), 
                key: name, 
                'data-name': name, 
                onClick: this.props.onChangeTab.bind(null, name)}, 
                val.name)
        }.bind(this)) 
    },
});

module.exports = Tabs

},{}],22:[function(require,module,exports){
"use strict";
var Store = require('./store');
module.exports = UIState;
function UIState(dispatcher) {
  Store.mixin(this);
  this.tab = 'setup';
  this.selectedPlayer = null;
  this.selectionConfirmed = false;
  this.missionRevealed = false;
  dispatcher.onAction(function(payload) {
    var actions = UIState.actions;
    if (_.isFunction(actions[payload.action])) {
      actions[payload.action].call(this, payload);
      this.save();
    }
  }.bind(this));
}
var PERSIST_KEYS = ['tab', 'selectedPlayer', 'selectionConfirmed', 'missionRevealed'];
UIState.prototype.save = function() {
  var $__0 = this;
  var persist = {};
  PERSIST_KEYS.forEach((function(key) {
    return persist[key] = $__0[key];
  }));
  store.set('store.uistate', persist);
};
UIState.prototype.load = function() {
  var $__0 = this;
  var persist = store.get('store.uistate');
  if (persist !== undefined) {
    PERSIST_KEYS.forEach((function(key) {
      return $__0[key] = persist[key];
    }));
  }
};
UIState.actions = {};
UIState.actions.changeTab = function($__1) {
  var tab = $__1.tab;
  this.tab = tab;
  this.selectedPlayer = null;
  this.selectionConfirmed = false;
  this.emitChange();
};
UIState.actions.selectPlayer = function($__1) {
  var name = $__1.name;
  this.selectedPlayer = name;
  this.selectionConfirmed = false;
  this.emitChange();
};
UIState.actions.confirmPlayer = function($__1) {
  var name = $__1.name;
  this.selectedPlayer = name;
  this.selectionConfirmed = true;
  this.emitChange();
};
UIState.actions.deselectPlayer = function() {
  this.selectedPlayer = null;
  this.selectionConfirmed = false;
  this.emitChange();
};
UIState.actions.missionReveal = function() {
  this.missionRevealed = true;
  this.emitChange();
};
UIState.actions.missionReset = function() {
  this.missionRevealed = false;
  this.emitChange();
};
UIState.actions.newRoles = function() {
  this.tab = 'roles';
  this.selectedPlayer = null;
  this.selectionConfirmed = false;
  this.emitChange();
};


},{"./store":20}]},{},[6])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9ub2RlX21vZHVsZXMvYmFja2JvbmUtZXZlbnRzLXN0YW5kYWxvbmUvYmFja2JvbmUtZXZlbnRzLXN0YW5kYWxvbmUuanMiLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9ub2RlX21vZHVsZXMvYmFja2JvbmUtZXZlbnRzLXN0YW5kYWxvbmUvaW5kZXguanMiLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL2NvbG9yLmpzIiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9kaXNwYXRjaGVyLmpzIiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9nYW1lLXN0YXRlLmpzIiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9pbmRleC5qcyIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvbGFiZWxlZC1udW1iZXIuanN4IiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9taXNzaW9uLXBhZ2UuanN4IiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9taXNzaW9uLXN0YXRlLmpzIiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9uYW1lbGV0LmpzeCIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvbmV3LW5hbWUuanN4IiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy9wbGF5ZXItY2hpcC5qc3giLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL3JvbGUtY2FyZC5qc3giLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL3JvbGUtcGxheWVyLWVudHJ5LmpzeCIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvcm9sZXMtcGFnZS5qc3giLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL3NldHRpbmdzLmpzeCIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvc2V0dXAtcGFnZS5qc3giLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL3NldHVwLXBsYXllci1saXN0LmpzeCIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvc3RvcmUtcmVzZXQuanMiLCIvaG9tZS9taWxlcy9jb2RlL3JlYWN0YW5jZS9zY3JpcHRzL3N0b3JlLmpzIiwiL2hvbWUvbWlsZXMvY29kZS9yZWFjdGFuY2Uvc2NyaXB0cy90YWJzLmpzeCIsIi9ob21lL21pbGVzL2NvZGUvcmVhY3RhbmNlL3NjcmlwdHMvdWktc3RhdGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMVFBO0FBQ0E7O0FDREE7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U0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0NBS2hDOzs7QUM1RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNySEE7QUFBSSxDQUFKLEVBQUksQ0FBQSxLQUFLLEVBQUcsQ0FBQSxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUE7QUFFOUIsQ0FBQSxLQUFNLFFBQVEsRUFBRyxhQUFZLENBQUE7Q0FFN0IsT0FBUyxhQUFZLENBQUMsVUFBVSxDQUFFO0FBQzlCLENBQUEsTUFBSyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7QUFFakIsQ0FBQSxLQUFJLE9BQU8sRUFBRyxFQUFDLENBQUE7QUFDZixDQUFBLEtBQUksTUFBTSxFQUFHLEVBQUMsQ0FBQTtBQUNkLENBQUEsS0FBSSxRQUFRLEVBQUcsR0FBRSxDQUFBO0FBRWpCLENBQUEsV0FBVSxTQUFTLENBQUMsU0FBUyxPQUFPLENBQUU7QUFDOUIsQ0FBSixNQUFJLENBQUEsT0FBTyxFQUFHLENBQUEsWUFBWSxRQUFRLENBQUE7Q0FDbEMsT0FBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFFO0FBQ3ZDLENBQUEsWUFBTyxDQUFDLE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUUsUUFBTyxDQUFDLENBQUE7QUFDM0MsQ0FBQSxTQUFJLEtBQUssRUFBRSxDQUFBO0tBQ2Q7Q0FBQSxFQUNKLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0NBQ2hCO0FBRUcsQ0FGSCxFQUVHLENBQUEsWUFBWSxFQUFHLEVBQUMsUUFBUSxDQUFFLFFBQU8sQ0FBRSxVQUFTLENBQUMsQ0FBQTtBQUVqRCxDQUFBLFdBQVksVUFBVSxLQUFLLEVBQUcsVUFBUzs7QUFDL0IsQ0FBSixJQUFJLENBQUEsT0FBTyxFQUFHLEdBQUUsQ0FBQTtBQUNoQixDQUFBLGFBQVksUUFBUSxXQUFDLEdBQUc7VUFBSSxDQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRyxNQUFLLEdBQUcsQ0FBQztLQUFDLENBQUE7QUFDckQsQ0FBQSxNQUFLLElBQUksQ0FBQyxvQkFBb0IsQ0FBRSxRQUFPLENBQUMsQ0FBQTtDQUMzQyxDQUFBO0FBRUQsQ0FBQSxXQUFZLFVBQVUsS0FBSyxFQUFHLFVBQVM7O0FBQy9CLENBQUosSUFBSSxDQUFBLE9BQU8sRUFBRyxDQUFBLEtBQUssSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUE7Q0FDN0MsS0FBSSxPQUFPLElBQUssVUFBUyxDQUFFO0FBQ3ZCLENBQUEsZUFBWSxRQUFRLFdBQUMsR0FBRztZQUFJLENBQUEsS0FBSyxHQUFHLENBQUMsRUFBRyxDQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUM7T0FBQyxDQUFBO0dBQ3hEO0NBQUEsQUFDSixDQUFBO0FBRUQsQ0FBQSxXQUFZLFVBQVUsYUFBYSxFQUFHLFVBQVMsQ0FBRTtBQUM3QyxDQUFBLEtBQUksT0FBTyxFQUFHLEVBQUMsQ0FBQTtBQUNmLENBQUEsS0FBSSxNQUFNLEVBQUcsRUFBQyxDQUFBO0FBQ2QsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLFdBQVksVUFBVSxvQkFBb0IsRUFBRyxVQUFTLENBQUU7QUFDcEQsQ0FBQSxLQUFJLFFBQVEsRUFBRyxHQUFFLENBQUE7QUFDakIsQ0FBQSxLQUFJLGFBQWEsRUFBRSxDQUFBO0NBQ3RCLENBQUE7QUFFRCxDQUFBLFdBQVksUUFBUSxFQUFHLEdBQUUsQ0FBQTtBQUV6QixDQUFBLFdBQVksUUFBUSxZQUFZLEVBQUcsVUFBUyxJQUFNLENBQUU7O0NBQ2hELEtBQUksSUFBSSxDQUFFO0FBQ04sQ0FBQSxPQUFJLE9BQU8sR0FBSSxFQUFDLENBQUE7R0FDbkIsS0FBTTtBQUNILENBQUEsT0FBSSxNQUFNLEdBQUksRUFBQyxDQUFBO0dBQ2xCO0FBQ0QsQ0FEQyxLQUNHLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLFdBQVksUUFBUSxhQUFhLEVBQUcsVUFBUyxDQUFFO0FBQzNDLENBQUEsS0FBSSxhQUFhLEVBQUUsQ0FBQTtDQUN0QixDQUFBO0FBRUQsQ0FBQSxXQUFZLFFBQVEsVUFBVSxFQUFHLFVBQVMsSUFBTSxDQUFFOztBQUM5QyxDQUFBLEtBQUksb0JBQW9CLEVBQUUsQ0FBQTtDQUM3QixDQUFBO0FBRUQsQ0FBQSxXQUFZLFFBQVEsYUFBYSxFQUFHLFVBQVMsSUFBTSxDQUFFOztBQUNqRCxDQUFBLEtBQUksb0JBQW9CLEVBQUUsQ0FBQTtDQUM3QixDQUFBO0FBRUQsQ0FBQSxXQUFZLFFBQVEsZUFBZSxFQUFHLFVBQVMsSUFBVSxDQUFFOztBQUN2RCxDQUFBLEtBQUksb0JBQW9CLEVBQUUsQ0FBQTtDQUM3QixDQUFBO0FBRUQsQ0FBQSxXQUFZLFFBQVEsU0FBUyxFQUFHLFVBQVMsQ0FBRTtBQUN2QyxDQUFBLEtBQUksb0JBQW9CLEVBQUUsQ0FBQTtDQUM3QixDQUFBO0FBRUQsQ0FBQSxXQUFZLFFBQVEsY0FBYyxFQUFHLFVBQVMsQ0FBRTtBQUM1QyxDQUFBLEtBQUksUUFBUSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsQ0FBQTtDQUNoQyxDQUFBO0NBQ0Q7OztBQ2hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUFBLENBQUEsS0FBTSxRQUFRLEVBQUcsWUFBVyxDQUFBO0NBRTVCLE9BQVMsWUFBVyxDQUFDLE9BQU8sQ0FBRTtBQUN0QixDQUFKLElBQUksQ0FBQSxNQUFNLEVBQUcsQ0FBQSxLQUFLLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO0NBQzFDLEtBQUksTUFBTSxJQUFLLFFBQU8sQ0FBRTtDQUNwQixVQUFNO0dBQ1QsS0FBTTtBQUNILENBQUEsUUFBSyxNQUFNLEVBQUUsQ0FBQTtBQUNiLENBQUEsUUFBSyxJQUFJLENBQUMsa0JBQWtCLENBQUUsUUFBTyxDQUFDLENBQUE7R0FDekM7Q0FBQSxB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USxhQUFhLEVBQUcsVUFBUyxJQUFNLENBQUU7O0FBQzVDLENBQUEsS0FBSSxlQUFlLEVBQUcsS0FBSSxDQUFBO0FBQzFCLENBQUEsS0FBSSxtQkFBbUIsRUFBRyxNQUFLLENBQUE7QUFDL0IsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLE1BQU8sUUFBUSxjQUFjLEVBQUcsVUFBUyxJQUFNLENBQUU7O0FBQzdDLENBQUEsS0FBSSxlQUFlLEVBQUcsS0FBSSxDQUFBO0FBQzFCLENBQUEsS0FBSSxtQkFBbUIsRUFBRyxLQUFJLENBQUE7QUFDOUIsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLE1BQU8sUUFBUSxlQUFlLEVBQUcsVUFBUyxDQUFFO0FBQ3hDLENBQUEsS0FBSSxlQUFlLEVBQUcsS0FBSSxDQUFBO0FBQzFCLENBQUEsS0FBSSxtQkFBbUIsRUFBRyxNQUFLLENBQUE7QUFDL0IsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLE1BQU8sUUFBUSxjQUFjLEVBQUcsVUFBUyxDQUFFO0FBQ3ZDLENBQUEsS0FBSSxnQkFBZ0IsRUFBRyxLQUFJLENBQUE7QUFDM0IsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLE1BQU8sUUFBUSxhQUFhLEVBQUcsVUFBUyxDQUFFO0FBQ3RDLENBQUEsS0FBSSxnQkFBZ0IsRUFBRyxNQUFLLENBQUE7QUFDNUIsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7QUFFRCxDQUFBLE1BQU8sUUFBUSxTQUFTLEVBQUcsVUFBUyxDQUFFO0FBQ2xDLENBQUEsS0FBSSxJQUFJLEVBQUcsUUFBTyxDQUFBO0FBQ2xCLENBQUEsS0FBSSxlQUFlLEVBQUcsS0FBSSxDQUFBO0FBQzFCLENBQUEsS0FBSSxtQkFBbUIsRUFBRyxNQUFLLENBQUE7QUFDL0IsQ0FBQSxLQUFJLFdBQVcsRUFBRSxDQUFBO0NBQ3BCLENBQUE7Q0FDRCIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIFN0YW5kYWxvbmUgZXh0cmFjdGlvbiBvZiBCYWNrYm9uZS5FdmVudHMsIG5vIGV4dGVybmFsIGRlcGVuZGVuY3kgcmVxdWlyZWQuXG4gKiBEZWdyYWRlcyBuaWNlbHkgd2hlbiBCYWNrb25lL3VuZGVyc2NvcmUgYXJlIGFscmVhZHkgYXZhaWxhYmxlIGluIHRoZSBjdXJyZW50XG4gKiBnbG9iYWwgY29udGV4dC5cbiAqXG4gKiBOb3RlIHRoYXQgZG9jcyBzdWdnZXN0IHRvIHVzZSB1bmRlcnNjb3JlJ3MgYF8uZXh0ZW5kKClgIG1ldGhvZCB0byBhZGQgRXZlbnRzXG4gKiBzdXBwb3J0IHRvIHNvbWUgZ2l2ZW4gb2JqZWN0LiBBIGBtaXhpbigpYCBtZXRob2QgaGFzIGJlZW4gYWRkZWQgdG8gdGhlIEV2ZW50c1xuICogcHJvdG90eXBlIHRvIGF2b2lkIHVzaW5nIHVuZGVyc2NvcmUgZm9yIHRoYXQgc29sZSBwdXJwb3NlOlxuICpcbiAqICAgICB2YXIgbXlFdmVudEVtaXR0ZXIgPSBCYWNrYm9uZUV2ZW50cy5taXhpbih7fSk7XG4gKlxuICogT3IgZm9yIGEgZnVuY3Rpb24gY29uc3RydWN0b3I6XG4gKlxuICogICAgIGZ1bmN0aW9uIE15Q29uc3RydWN0b3IoKXt9XG4gKiAgICAgTXlDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZm9vID0gZnVuY3Rpb24oKXt9XG4gKiAgICAgQmFja2JvbmVFdmVudHMubWl4aW4oTXlDb25zdHJ1Y3Rvci5wcm90b3R5cGUpO1xuICpcbiAqIChjKSAyMDA5LTIwMTMgSmVyZW15IEFzaGtlbmFzLCBEb2N1bWVudENsb3VkIEluYy5cbiAqIChjKSAyMDEzIE5pY29sYXMgUGVycmlhdWx0XG4gKi9cbi8qIGdsb2JhbCBleHBvcnRzOnRydWUsIGRlZmluZSwgbW9kdWxlICovXG4oZnVuY3Rpb24oKSB7XG4gIHZhciByb290ID0gdGhpcyxcbiAgICAgIGJyZWFrZXIgPSB7fSxcbiAgICAgIG5hdGl2ZUZvckVhY2ggPSBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCxcbiAgICAgIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSxcbiAgICAgIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLFxuICAgICAgaWRDb3VudGVyID0gMDtcblxuICAvLyBSZXR1cm5zIGEgcGFydGlhbCBpbXBsZW1lbnRhdGlvbiBtYXRjaGluZyB0aGUgbWluaW1hbCBBUEkgc3Vic2V0IHJlcXVpcmVkXG4gIC8vIGJ5IEJhY2tib25lLkV2ZW50c1xuICBmdW5jdGlvbiBtaW5pc2NvcmUoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGtleXM6IE9iamVjdC5rZXlzLFxuXG4gICAgICB1bmlxdWVJZDogZnVuY3Rpb24ocHJlZml4KSB7XG4gICAgICAgIHZhciBpZCA9ICsraWRDb3VudGVyICsgJyc7XG4gICAgICAgIHJldHVybiBwcmVmaXggPyBwcmVmaXggKyBpZCA6IGlkO1xuICAgICAgfSxcblxuICAgICAgaGFzOiBmdW5jdGlvbihvYmosIGtleSkge1xuICAgICAgICByZXR1cm4gaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSk7XG4gICAgICB9LFxuXG4gICAgICBlYWNoOiBmdW5jdGlvbihvYmosIGl0ZXJhdG9yLCBjb250ZXh0KSB7XG4gICAgICAgIGlmIChvYmogPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBpZiAobmF0aXZlRm9yRWFjaCAmJiBvYmouZm9yRWFjaCA9PT0gbmF0aXZlRm9yRWFjaCkge1xuICAgICAgICAgIG9iai5mb3JFYWNoKGl0ZXJhdG9yLCBjb250ZXh0KTtcbiAgICAgICAgfSBlbHNlIGlmIChvYmoubGVuZ3RoID09PSArb2JqLmxlbmd0aCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gb2JqLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgaWYgKGl0ZXJhdG9yLmNhbGwoY29udGV4dCwgb2JqW2ldLCBpLCBvYmopID09PSBicmVha2VyKSByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmhhcyhvYmosIGtleSkpIHtcbiAgICAgICAgICAgICAgaWYgKGl0ZXJhdG9yLmNhbGwoY29udGV4dCwgb2JqW2tleV0sIGtleSwgb2JqKSA9PT0gYnJlYWtlcikgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcblxuICAgICAgb25jZTogZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YXIgcmFuID0gZmFsc2UsIG1lbW87XG4gICAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAocmFuKSByZXR1cm4gbWVtbztcbiAgICAgICAgICByYW4gPSB0cnVlO1xuICAgICAgICAgIG1lbW8gPSBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgZnVuYyA9IG51bGw7XG4gICAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIHZhciBfID0gbWluaXNjb3JlKCksIEV2ZW50cztcblxuICAvLyBCYWNrYm9uZS5FdmVudHNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gQSBtb2R1bGUgdGhhdCBjYW4gYmUgbWl4ZWQgaW4gdG8gKmFueSBvYmplY3QqIGluIG9yZGVyIHRvIHByb3ZpZGUgaXQgd2l0aFxuICAvLyBjdXN0b20gZXZlbnRzLiBZb3UgbWF5IGJpbmQgd2l0aCBgb25gIG9yIHJlbW92ZSB3aXRoIGBvZmZgIGNhbGxiYWNrXG4gIC8vIGZ1bmN0aW9ucyB0byBhbiBldmVudDsgYHRyaWdnZXJgLWluZyBhbiBldmVudCBmaXJlcyBhbGwgY2FsbGJhY2tzIGluXG4gIC8vIHN1Y2Nlc3Npb24uXG4gIC8vXG4gIC8vICAgICB2YXIgb2JqZWN0ID0ge307XG4gIC8vICAgICBfLmV4dGVuZChvYmplY3QsIEJhY2tib25lLkV2ZW50cyk7XG4gIC8vICAgICBvYmplY3Qub24oJ2V4cGFuZCcsIGZ1bmN0aW9uKCl7IGFsZXJ0KCdleHBhbmRlZCcpOyB9KTtcbiAgLy8gICAgIG9iamVjdC50cmlnZ2VyKCdleHBhbmQnKTtcbiAgLy9cbiAgRXZlbnRzID0ge1xuXG4gICAgLy8gQmluZCBhbiBldmVudCB0byBhIGBjYWxsYmFja2AgZnVuY3Rpb24uIFBhc3NpbmcgYFwiYWxsXCJgIHdpbGwgYmluZFxuICAgIC8vIHRoZSBjYWxsYmFjayB0byBhbGwgZXZlbnRzIGZpcmVkLlxuICAgIG9uOiBmdW5jdGlvbihuYW1lLCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgICAgaWYgKCFldmVudHNBcGkodGhpcywgJ29uJywgbmFtZSwgW2NhbGxiYWNrLCBjb250ZXh0XSkgfHwgIWNhbGxiYWNrKSByZXR1cm4gdGhpcztcbiAgICAgIHRoaXMuX2V2ZW50cyB8fCAodGhpcy5fZXZlbnRzID0ge30pO1xuICAgICAgdmFyIGV2ZW50cyA9IHRoaXMuX2V2ZW50c1tuYW1lXSB8fCAodGhpcy5fZXZlbnRzW25hbWVdID0gW10pO1xuICAgICAgZXZlbnRzLnB1c2goe2NhbGxiYWNrOiBjYWxsYmFjaywgY29udGV4dDogY29udGV4dCwgY3R4OiBjb250ZXh0IHx8IHRoaXN9KTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICAvLyBCaW5kIGFuIGV2ZW50IHRvIG9ubHkgYmUgdHJpZ2dlcmVkIGEgc2luZ2xlIHRpbWUuIEFmdGVyIHRoZSBmaXJzdCB0aW1lXG4gICAgLy8gdGhlIGNhbGxiYWNrIGlzIGludm9rZWQsIGl0IHdpbGwgYmUgcmVtb3ZlZC5cbiAgICBvbmNlOiBmdW5jdGlvbihuYW1lLCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgICAgaWYgKCFldmVudHNBcGkodGhpcywgJ29uY2UnLCBuYW1lLCBbY2FsbGJhY2ssIGNvbnRleHRdKSB8fCAhY2FsbGJhY2spIHJldHVybiB0aGlzO1xuICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgdmFyIG9uY2UgPSBfLm9uY2UoZnVuY3Rpb24oKSB7XG4gICAgICAgIHNlbGYub2ZmKG5hbWUsIG9uY2UpO1xuICAgICAgICBjYWxsYmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfSk7XG4gICAgICBvbmNlLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgcmV0dXJuIHRoaXMub24obmFtZSwgb25jZSwgY29udGV4dCk7XG4gICAgfSxcblxuICAgIC8vIFJlbW92ZSBvbmUgb3IgbWFueSBjYWxsYmFja3MuIElmIGBjb250ZXh0YCBpcyBudWxsLCByZW1vdmVzIGFsbFxuICAgIC8vIGNhbGxiYWNrcyB3aXRoIHRoYXQgZnVuY3Rpb24uIElmIGBjYWxsYmFja2AgaXMgbnVsbCwgcmVtb3ZlcyBhbGxcbiAgICAvLyBjYWxsYmFja3MgZm9yIHRoZSBldmVudC4gSWYgYG5hbWVgIGlzIG51bGwsIHJlbW92ZXMgYWxsIGJvdW5kXG4gICAgLy8gY2FsbGJhY2tzIGZvciBhbGwgZXZlbnRzLlxuICAgIG9mZjogZnVuY3Rpb24obmFtZSwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICAgIHZhciByZXRhaW4sIGV2LCBldmVudHMsIG5hbWVzLCBpLCBsLCBqLCBrO1xuICAgICAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIWV2ZW50c0FwaSh0aGlzLCAnb2ZmJywgbmFtZSwgW2NhbGxiYWNrLCBjb250ZXh0XSkpIHJldHVybiB0aGlzO1xuICAgICAgaWYgKCFuYW1lICYmICFjYWxsYmFjayAmJiAhY29udGV4dCkge1xuICAgICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9XG5cbiAgICAgIG5hbWVzID0gbmFtZSA/IFtuYW1lXSA6IF8ua2V5cyh0aGlzLl9ldmVudHMpO1xuICAgICAgZm9yIChpID0gMCwgbCA9IG5hbWVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBuYW1lID0gbmFtZXNbaV07XG4gICAgICAgIGlmIChldmVudHMgPSB0aGlzLl9ldmVudHNbbmFtZV0pIHtcbiAgICAgICAgICB0aGlzLl9ldmVudHNbbmFtZV0gPSByZXRhaW4gPSBbXTtcbiAgICAgICAgICBpZiAoY2FsbGJhY2sgfHwgY29udGV4dCkge1xuICAgICAgICAgICAgZm9yIChqID0gMCwgayA9IGV2ZW50cy5sZW5ndGg7IGogPCBrOyBqKyspIHtcbiAgICAgICAgICAgICAgZXYgPSBldmVudHNbal07XG4gICAgICAgICAgICAgIGlmICgoY2FsbGJhY2sgJiYgY2FsbGJhY2sgIT09IGV2LmNhbGxiYWNrICYmIGNhbGxiYWNrICE9PSBldi5jYWxsYmFjay5fY2FsbGJhY2spIHx8XG4gICAgICAgICAgICAgICAgICAoY29udGV4dCAmJiBjb250ZXh0ICE9PSBldi5jb250ZXh0KSkge1xuICAgICAgICAgICAgICAgIHJldGFpbi5wdXNoKGV2KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIXJldGFpbi5sZW5ndGgpIGRlbGV0ZSB0aGlzLl9ldmVudHNbbmFtZV07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcblxuICAgIC8vIFRyaWdnZXIgb25lIG9yIG1hbnkgZXZlbnRzLCBmaXJpbmcgYWxsIGJvdW5kIGNhbGxiYWNrcy4gQ2FsbGJhY2tzIGFyZVxuICAgIC8vIHBhc3NlZCB0aGUgc2FtZSBhcmd1bWVudHMgYXMgYHRyaWdnZXJgIGlzLCBhcGFydCBmcm9tIHRoZSBldmVudCBuYW1lXG4gICAgLy8gKHVubGVzcyB5b3UncmUgbGlzdGVuaW5nIG9uIGBcImFsbFwiYCwgd2hpY2ggd2lsbCBjYXVzZSB5b3VyIGNhbGxiYWNrIHRvXG4gICAgLy8gcmVjZWl2ZSB0aGUgdHJ1ZSBuYW1lIG9mIHRoZSBldmVudCBhcyB0aGUgZmlyc3QgYXJndW1lbnQpLlxuICAgIHRyaWdnZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGlmICghdGhpcy5fZXZlbnRzKSByZXR1cm4gdGhpcztcbiAgICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgaWYgKCFldmVudHNBcGkodGhpcywgJ3RyaWdnZXInLCBuYW1lLCBhcmdzKSkgcmV0dXJuIHRoaXM7XG4gICAgICB2YXIgZXZlbnRzID0gdGhpcy5fZXZlbnRzW25hbWVdO1xuICAgICAgdmFyIGFsbEV2ZW50cyA9IHRoaXMuX2V2ZW50cy5hbGw7XG4gICAgICBpZiAoZXZlbnRzKSB0cmlnZ2VyRXZlbnRzKGV2ZW50cywgYXJncyk7XG4gICAgICBpZiAoYWxsRXZlbnRzKSB0cmlnZ2VyRXZlbnRzKGFsbEV2ZW50cywgYXJndW1lbnRzKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG5cbiAgICAvLyBUZWxsIHRoaXMgb2JqZWN0IHRvIHN0b3AgbGlzdGVuaW5nIHRvIGVpdGhlciBzcGVjaWZpYyBldmVudHMgLi4uIG9yXG4gICAgLy8gdG8gZXZlcnkgb2JqZWN0IGl0J3MgY3VycmVudGx5IGxpc3RlbmluZyB0by5cbiAgICBzdG9wTGlzdGVuaW5nOiBmdW5jdGlvbihvYmosIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICB2YXIgbGlzdGVuZXJzID0gdGhpcy5fbGlzdGVuZXJzO1xuICAgICAgaWYgKCFsaXN0ZW5lcnMpIHJldHVybiB0aGlzO1xuICAgICAgdmFyIGRlbGV0ZUxpc3RlbmVyID0gIW5hbWUgJiYgIWNhbGxiYWNrO1xuICAgICAgaWYgKHR5cGVvZiBuYW1lID09PSAnb2JqZWN0JykgY2FsbGJhY2sgPSB0aGlzO1xuICAgICAgaWYgKG9iaikgKGxpc3RlbmVycyA9IHt9KVtvYmouX2xpc3RlbmVySWRdID0gb2JqO1xuICAgICAgZm9yICh2YXIgaWQgaW4gbGlzdGVuZXJzKSB7XG4gICAgICAgIGxpc3RlbmVyc1tpZF0ub2ZmKG5hbWUsIGNhbGxiYWNrLCB0aGlzKTtcbiAgICAgICAgaWYgKGRlbGV0ZUxpc3RlbmVyKSBkZWxldGUgdGhpcy5fbGlzdGVuZXJzW2lkXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICB9O1xuXG4gIC8vIFJlZ3VsYXIgZXhwcmVzc2lvbiB1c2VkIHRvIHNwbGl0IGV2ZW50IHN0cmluZ3MuXG4gIHZhciBldmVudFNwbGl0dGVyID0gL1xccysvO1xuXG4gIC8vIEltcGxlbWVudCBmYW5jeSBmZWF0dXJlcyBvZiB0aGUgRXZlbnRzIEFQSSBzdWNoIGFzIG11bHRpcGxlIGV2ZW50XG4gIC8vIG5hbWVzIGBcImNoYW5nZSBibHVyXCJgIGFuZCBqUXVlcnktc3R5bGUgZXZlbnQgbWFwcyBge2NoYW5nZTogYWN0aW9ufWBcbiAgLy8gaW4gdGVybXMgb2YgdGhlIGV4aXN0aW5nIEFQSS5cbiAgdmFyIGV2ZW50c0FwaSA9IGZ1bmN0aW9uKG9iaiwgYWN0aW9uLCBuYW1lLCByZXN0KSB7XG4gICAgaWYgKCFuYW1lKSByZXR1cm4gdHJ1ZTtcblxuICAgIC8vIEhhbmRsZSBldmVudCBtYXBzLlxuICAgIGlmICh0eXBlb2YgbmFtZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGZvciAodmFyIGtleSBpbiBuYW1lKSB7XG4gICAgICAgIG9ialthY3Rpb25dLmFwcGx5KG9iaiwgW2tleSwgbmFtZVtrZXldXS5jb25jYXQocmVzdCkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBzcGFjZSBzZXBhcmF0ZWQgZXZlbnQgbmFtZXMuXG4gICAgaWYgKGV2ZW50U3BsaXR0ZXIudGVzdChuYW1lKSkge1xuICAgICAgdmFyIG5hbWVzID0gbmFtZS5zcGxpdChldmVudFNwbGl0dGVyKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gbmFtZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIG9ialthY3Rpb25dLmFwcGx5KG9iaiwgW25hbWVzW2ldXS5jb25jYXQocmVzdCkpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIC8vIEEgZGlmZmljdWx0LXRvLWJlbGlldmUsIGJ1dCBvcHRpbWl6ZWQgaW50ZXJuYWwgZGlzcGF0Y2ggZnVuY3Rpb24gZm9yXG4gIC8vIHRyaWdnZXJpbmcgZXZlbnRzLiBUcmllcyB0byBrZWVwIHRoZSB1c3VhbCBjYXNlcyBzcGVlZHkgKG1vc3QgaW50ZXJuYWxcbiAgLy8gQmFja2JvbmUgZXZlbnRzIGhhdmUgMyBhcmd1bWVudHMpLlxuICB2YXIgdHJpZ2dlckV2ZW50cyA9IGZ1bmN0aW9uKGV2ZW50cywgYXJncykge1xuICAgIHZhciBldiwgaSA9IC0xLCBsID0gZXZlbnRzLmxlbmd0aCwgYTEgPSBhcmdzWzBdLCBhMiA9IGFyZ3NbMV0sIGEzID0gYXJnc1syXTtcbiAgICBzd2l0Y2ggKGFyZ3MubGVuZ3RoKSB7XG4gICAgICBjYXNlIDA6IHdoaWxlICgrK2kgPCBsKSAoZXYgPSBldmVudHNbaV0pLmNhbGxiYWNrLmNhbGwoZXYuY3R4KTsgcmV0dXJuO1xuICAgICAgY2FzZSAxOiB3aGlsZSAoKytpIDwgbCkgKGV2ID0gZXZlbnRzW2ldKS5jYWxsYmFjay5jYWxsKGV2LmN0eCwgYTEpOyByZXR1cm47XG4gICAgICBjYXNlIDI6IHdoaWxlICgrK2kgPCBsKSAoZXYgPSBldmVudHNbaV0pLmNhbGxiYWNrLmNhbGwoZXYuY3R4LCBhMSwgYTIpOyByZXR1cm47XG4gICAgICBjYXNlIDM6IHdoaWxlICgrK2kgPCBsKSAoZXYgPSBldmVudHNbaV0pLmNhbGxiYWNrLmNhbGwoZXYuY3R4LCBhMSwgYTIsIGEzKTsgcmV0dXJuO1xuICAgICAgZGVmYXVsdDogd2hpbGUgKCsraSA8IGwpIChldiA9IGV2ZW50c1tpXSkuY2FsbGJhY2suYXBwbHkoZXYuY3R4LCBhcmdzKTtcbiAgICB9XG4gIH07XG5cbiAgdmFyIGxpc3Rlbk1ldGhvZHMgPSB7bGlzdGVuVG86ICdvbicsIGxpc3RlblRvT25jZTogJ29uY2UnfTtcblxuICAvLyBJbnZlcnNpb24tb2YtY29udHJvbCB2ZXJzaW9ucyBvZiBgb25gIGFuZCBgb25jZWAuIFRlbGwgKnRoaXMqIG9iamVjdCB0b1xuICAvLyBsaXN0ZW4gdG8gYW4gZXZlbnQgaW4gYW5vdGhlciBvYmplY3QgLi4uIGtlZXBpbmcgdHJhY2sgb2Ygd2hhdCBpdCdzXG4gIC8vIGxpc3RlbmluZyB0by5cbiAgXy5lYWNoKGxpc3Rlbk1ldGhvZHMsIGZ1bmN0aW9uKGltcGxlbWVudGF0aW9uLCBtZXRob2QpIHtcbiAgICBFdmVudHNbbWV0aG9kXSA9IGZ1bmN0aW9uKG9iaiwgbmFtZSwgY2FsbGJhY2spIHtcbiAgICAgIHZhciBsaXN0ZW5lcnMgPSB0aGlzLl9saXN0ZW5lcnMgfHwgKHRoaXMuX2xpc3RlbmVycyA9IHt9KTtcbiAgICAgIHZhciBpZCA9IG9iai5fbGlzdGVuZXJJZCB8fCAob2JqLl9saXN0ZW5lcklkID0gXy51bmlxdWVJZCgnbCcpKTtcbiAgICAgIGxpc3RlbmVyc1tpZF0gPSBvYmo7XG4gICAgICBpZiAodHlwZW9mIG5hbWUgPT09ICdvYmplY3QnKSBjYWxsYmFjayA9IHRoaXM7XG4gICAgICBvYmpbaW1wbGVtZW50YXRpb25dKG5hbWUsIGNhbGxiYWNrLCB0aGlzKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG4gIH0pO1xuXG4gIC8vIEFsaWFzZXMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5LlxuICBFdmVudHMuYmluZCAgID0gRXZlbnRzLm9uO1xuICBFdmVudHMudW5iaW5kID0gRXZlbnRzLm9mZjtcblxuICAvLyBNaXhpbiB1dGlsaXR5XG4gIEV2ZW50cy5taXhpbiA9IGZ1bmN0aW9uKHByb3RvKSB7XG4gICAgdmFyIGV4cG9ydHMgPSBbJ29uJywgJ29uY2UnLCAnb2ZmJywgJ3RyaWdnZXInLCAnc3RvcExpc3RlbmluZycsICdsaXN0ZW5UbycsXG4gICAgICAgICAgICAgICAgICAgJ2xpc3RlblRvT25jZScsICdiaW5kJywgJ3VuYmluZCddO1xuICAgIF8uZWFjaChleHBvcnRzLCBmdW5jdGlvbihuYW1lKSB7XG4gICAgICBwcm90b1tuYW1lXSA9IHRoaXNbbmFtZV07XG4gICAgfSwgdGhpcyk7XG4gICAgcmV0dXJuIHByb3RvO1xuICB9O1xuXG4gIC8vIEV4cG9ydCBFdmVudHMgYXMgQmFja2JvbmVFdmVudHMgZGVwZW5kaW5nIG9uIGN1cnJlbnQgY29udGV4dFxuICBpZiAodHlwZW9mIGRlZmluZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgZGVmaW5lKGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIEV2ZW50cztcbiAgICB9KTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgICAgIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IEV2ZW50cztcbiAgICB9XG4gICAgZXhwb3J0cy5CYWNrYm9uZUV2ZW50cyA9IEV2ZW50cztcbiAgfSBlbHNlIHtcbiAgICByb290LkJhY2tib25lRXZlbnRzID0gRXZlbnRzO1xuICB9XG59KSh0aGlzKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9iYWNrYm9uZS1ldmVudHMtc3RhbmRhbG9uZScpO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBjb2xvclN0eWxlRm9yUGxheWVyO1xuXG5mdW5jdGlvbiBjb2xvclN0eWxlRm9yUGxheWVyKHBsYXllcikge1xuICAgIC8vIEtlZXAgdGhpcyBpbiBzeW5jIHdpdGggaW5kZXgubGVzc1xuICAgIHZhciBudW1Db2xvcnMgPSAxMFxuICAgIHZhciBvZmZzZXQgPSA4XG4gICAgdmFyIG11bHQgPSAzXG4gICAgdmFyIGNvbG9yTnVtID0gTWF0aC5hYnMoaGFzaFN0cmluZyhwbGF5ZXIpICogbXVsdCArIG9mZnNldCkgJSAobnVtQ29sb3JzKSArIDFcbiAgICByZXR1cm4gYG5hbWVsZXQtJHtjb2xvck51bX1gXG59XG5cbmZ1bmN0aW9uIGdldENvbG9yRnJvbVN0cmluZyhwbGF5ZXIpIHtcbiAgICAvLyBjb2xvcnMgZnJvbSBodHRwOi8vZmxhdHVpY29sb3JzLmNvbS9cbiAgICB2YXIgY29sb3JzID0gW1wiI2MwMzkyYlwiLCBcIiMyN2FlNjBcIiwgXCIjMzQ5OGRiXCIsIFwiIzliNTliNlwiLCBcIiNmMWM0MGZcIiwgXCIjZTY3ZTIyXCIsIFwiI2U3NGMzY1wiXTtcblxuICAgIHJldHVybiBjb2xvcnNbaGFzaFN0cmluZyhwbGF5ZXIpICUgY29sb3JzLmxlbmd0aF07XG5cbn1cblxuZnVuY3Rpb24gaGFzaFN0cmluZyhzdHIpIHtcbiAgICB2YXIgaGFzaCA9IDAsIGksIGNociwgbGVuO1xuICAgIGlmIChzdHIubGVuZ3RoID09IDApIHJldHVybiBoYXNoO1xuICAgIGZvciAoaSA9IDAsIGxlbiA9IHN0ci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICBjaHIgICA9IHN0ci5jaGFyQ29kZUF0KGkpO1xuICAgICAgICBoYXNoICA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpICsgY2hyO1xuICAgICAgICBoYXNoIHw9IDA7XG4gICAgfVxuICAgIHJldHVybiBoYXNoO1xufVxuIiwiLyoqXG4gKiBGbHV4IERpc3BhdGNoZXJcbiAqXG4gKiBEaXNwYXRjaGVzIGFjdGlvbnMgdG8gbGlzdGVuZXJzIHJlZ2lzdGVyZWQgdXNpbmcgb25BY3Rpb24uXG4gKiBBY3Rpb25zIGFyZSBkZWxpdmVyZCBhcyBwYXlsb2FkcyBsaWtlXG4gKiAgIHthY3Rpb246ICdjaGFuZ2VTZXR0aW5ncycsIGNvbG9yOiBjb2xvcn1cbiAqIFRoZSAnYWN0aW9uJyBrZXkgaXMgcmVxdWlyZWQsIGFsbCBvdGhlciBrZXlzIGFyZSB1cCB0byB0aGUgYXBwbGljYXRpb24uXG4gKi9cbnZhciBCYWNrYm9uZUV2ZW50cyA9IHJlcXVpcmUoXCJiYWNrYm9uZS1ldmVudHMtc3RhbmRhbG9uZVwiKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEaXNwYXRjaGVyXG5cbmZ1bmN0aW9uIERpc3BhdGNoZXIoKSB7XG4gICAgdGhpcy5fZXZlbnRlciA9IEJhY2tib25lRXZlbnRzLm1peGluKHt9KVxufVxuXG4vKipcbiAqIERpc3BhdGNoIGFuIGFjdGlvbi5cbiAqIFVzYWdlOlxuICogZGlzcGF0Y2hlcignZmlkZ2V0JylcbiAqIGRpc3BhdGNoZXIoJ2ZpZGdldCcsIHt3aXRoOiAncGVuY2lsJ30pXG4gKiBkaXNwYXRjaGVyKHthY3Rpb246ICdmaWRnZXQnLCB3aXRoOiAncGVuY2lsJ30pXG4gKi9cbkRpc3BhdGNoZXIucHJvdG90eXBlLmRpc3BhdGNoID0gZnVuY3Rpb24oYWN0aW9uLCBwYXlsb2FkKSB7XG4gICAgaWYgKF8uaXNTdHJpbmcoYWN0aW9uKSkge1xuICAgICAgICBwYXlsb2FkID0gXy5leHRlbmQoe2FjdGlvbjogYWN0aW9ufSwgcGF5bG9hZClcbiAgICB9IGVsc2Uge1xuICAgICAgICBwYXlsb2FkID0gYWN0aW9uXG4gICAgfVxuICAgIGNvbnNvbGUubG9nKGBkaXNwYXRjaDogJHtwYXlsb2FkLmFjdGlvbn1gKVxuICAgIHRoaXMuX2V2ZW50ZXIudHJpZ2dlcignYWN0aW9uJywgcGF5bG9hZClcbn1cblxuLyoqXG4gKiBTaG9ydGhhbmQgdG8gcHJlcGFyZSBhIHNpbXBsZSBkaXNwYXRjaCBmdW5jdGlvbi5cbiAqIERvZXMgbm90IGZpcmUgYW4gZXZlbnQsIGJ1dCByZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCBjYW4uXG4gKiBUaGVzZSBhcmUgZXF1aXZhbGVudDpcbiAqIGRpc3BhdGNoZXIuYmFrZSgnY2hhbmdlU2V0dGluZycsICdjb2xvcicpXG4gKiAoY29sb3IpID0+IHsgZGlzcGF0Y2hlci5kaXNwYXRjaCgnY2hhbmdlU2V0dGluZycsIHtjb2xvcjogY29sb3J9KSB9XG4gKi9cbkRpc3BhdGNoZXIucHJvdG90eXBlLmJha2UgPSBmdW5jdGlvbihhY3Rpb24sIGZpZWxkKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGlucHV0KSB7XG4gICAgICAgIHZhciBwYXlsb2FkID0ge2FjdGlvbjogYWN0aW9ufVxuICAgICAgICBpZiAoZmllbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBwYXlsb2FkW2ZpZWxkXSA9IGlucHV0XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kaXNwYXRjaChwYXlsb2FkKVxuICAgIH0uYmluZCh0aGlzKVxufVxuXG4vKipcbiAqIFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gcmVjZWl2ZSBhbGwgYWN0aW9ucy5cbiAqIEV4YW1wbGU6XG4gKiBkaXNwYXRjaGVyLm9uQWN0aW9uKChhY3Rpb24pID0+IHtcbiAqICAgY29uc29sZS5sb2coYGdvdCBhY3Rpb24gb2YgdHlwZSAke3BheWxvYWQuYWN0aW9ufWBcbiAqIH0pXG4gKi9cbkRpc3BhdGNoZXIucHJvdG90eXBlLm9uQWN0aW9uID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgICB0aGlzLl9ldmVudGVyLm9uKCdhY3Rpb24nLCBjYWxsYmFjaylcbn1cblxuLyoqXG4gKiBVbnJlZ2lzdGVyIGEgY2FsbGJhY2sgcHJldmlvdXNseSByZWdpc3RlcmVkIHdpdGggb25BY3Rpb24uXG4gKi9cbkRpc3BhdGNoZXIucHJvdG90eXBlLm9mZkFjdGlvbiA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fZXZlbnRlci5vZmYoJ2FjdGlvbicsIGNhbGxiYWNrKVxufVxuIiwidmFyIFN0b3JlID0gcmVxdWlyZSgnLi9zdG9yZScpXG5cbm1vZHVsZS5leHBvcnRzID0gR2FtZVN0YXRlXG5cbmZ1bmN0aW9uIEdhbWVTdGF0ZShkaXNwYXRjaGVyKSB7XG4gICAgU3RvcmUubWl4aW4odGhpcylcblxuICAgIHRoaXMucGxheWVyTmFtZXMgPSBbJ01pbGVzJywgJ0plc3MnLCAnQnJhbmRvbicsICdDaWFyYScsICdDaHJpcyddXG4gICAgdGhpcy5zZXR0aW5ncyA9IHtcbiAgICAgICAgbWVybGluOiB0cnVlLFxuICAgICAgICBtb3JkcmVkOiBmYWxzZSxcbiAgICAgICAgcGVyY2l2YWw6IGZhbHNlLFxuICAgICAgICBtb3JnYW5hOiBmYWxzZSxcbiAgICAgICAgb2Jlcm9uOiBmYWxzZVxuICAgIH1cbiAgICB0aGlzLnJvbGVzID0gbnVsbFxuICAgIC8vIFJlYXNvbiB0aGF0IHJvbGVzIGNhbm5vdCBiZSBhc3NpZ25lZC5cbiAgICAvLyBPbmUgb2Y6IHRvb01hbnksIHRvb0Zld1xuICAgIHRoaXMuZGlzYWJsZWRSZWFzb24gPSBudWxsXG5cbiAgICB0aGlzLnVwZGF0ZVJvbGVzKClcblxuICAgIGRpc3BhdGNoZXIub25BY3Rpb24oZnVuY3Rpb24ocGF5bG9hZCkge1xuICAgICAgICB2YXIgYWN0aW9ucyA9IEdhbWVTdGF0ZS5hY3Rpb25zXG4gICAgICAgIGlmIChfLmlzRnVuY3Rpb24oYWN0aW9uc1twYXlsb2FkLmFjdGlvbl0pKSB7XG4gICAgICAgICAgICBhY3Rpb25zW3BheWxvYWQuYWN0aW9uXS5jYWxsKHRoaXMsIHBheWxvYWQpXG4gICAgICAgICAgICB0aGlzLnNhdmUoKVxuICAgICAgICB9XG4gICAgfS5iaW5kKHRoaXMpKVxufVxuXG52YXIgUEVSU0lTVF9LRVlTID0gWydwbGF5ZXJOYW1lcycsICdzZXR0aW5ncycsICdyb2xlcycsICdkaXNhYmxlZFJlYXNvbiddXG5cbkdhbWVTdGF0ZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwZXJzaXN0ID0ge31cbiAgICBQRVJTSVNUX0tFWVMuZm9yRWFjaChrZXkgPT4gcGVyc2lzdFtrZXldID0gdGhpc1trZXldKVxuICAgIHN0b3JlLnNldCgnc3RvcmUuZ2FtZXN0YXRlJywgcGVyc2lzdClcbn1cblxuR2FtZVN0YXRlLnByb3RvdHlwZS5sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBlcnNpc3QgPSBzdG9yZS5nZXQoJ3N0b3JlLmdhbWVzdGF0ZScpXG4gICAgaWYgKHBlcnNpc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBQRVJTSVNUX0tFWVMuZm9yRWFjaChrZXkgPT4gdGhpc1trZXldID0gcGVyc2lzdFtrZXldKVxuICAgIH1cbiAgICB0aGlzLnVwZGF0ZVJvbGVzKClcbn1cblxuLyoqXG4gKiBHZXQgYSByb2xlIGZvciBhIHVzZXIuXG4gKiBBZGRzIHNvbWUgZXh0cmEgdXNlZnVsIGluZm8gdG8gdGhlIHJldHVybmVkIHJvbGUuXG4gKi9cbkdhbWVTdGF0ZS5wcm90b3R5cGUuZ2V0Um9sZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBpZiAodGhpcy5yb2xlcyA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICB2YXIgcm9sZSA9IF8uZXh0ZW5kKHt9LCB0aGlzLnJvbGVzW25hbWVdKVxuICAgIGlmIChyb2xlLnNweSkge1xuICAgICAgICByb2xlLm90aGVyU3BpZXMgPSBfLmZpbHRlcih0aGlzLmdldFNwaWVzKCksICh0aGVpck5hbWUpID0+XG4gICAgICAgICAgICAhdGhpcy5yb2xlc1t0aGVpck5hbWVdLm9iZXJvbiAmJiBuYW1lICE9IHRoZWlyTmFtZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3Mub2Jlcm9uKSB7XG4gICAgICAgICAgICByb2xlLmhhc09iZXJvbiA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKHJvbGUubWVybGluKSB7XG4gICAgICAgIHJvbGUuc3BpZXMgPSBfLmZpbHRlcih0aGlzLmdldFNwaWVzKCksIChuYW1lKSA9PlxuICAgICAgICAgICAgIXRoaXMucm9sZXNbbmFtZV0ubW9yZHJlZCk7XG4gICAgfVxuICAgIGlmIChyb2xlLnBlcmNpdmFsKSB7XG4gICAgICAgIHJvbGUubWVybGlucyA9IHRoaXMuZ2V0TWVybGlucygpXG4gICAgfVxuICAgIHJldHVybiByb2xlXG59XG5cbkdhbWVTdGF0ZS5wcm90b3R5cGUuZ2V0U3BpZXMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIodGhpcy5wbGF5ZXJOYW1lcywgKG5hbWUpID0+XG4gICAgICAgIHRoaXMucm9sZXNbbmFtZV0uc3B5KVxufVxuXG5HYW1lU3RhdGUucHJvdG90eXBlLmdldE1lcmxpbnMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIodGhpcy5wbGF5ZXJOYW1lcywgKG5hbWUpID0+XG4gICAgICAgIHRoaXMucm9sZXNbbmFtZV0ubW9yZ2FuYSB8fCB0aGlzLnJvbGVzW25hbWVdLm1lcmxpbik7XG59XG5cbi8qKlxuICogVHJ5IHRvIGFzc2lnbiByb2xlcy5cbiAqIFRoaXMgc2hvdWxkIG5vdCBiZSBjYWxsZWQgaWYgaXQncyBub3QgcG9zc2libGUuXG4gKi9cbkdhbWVTdGF0ZS5wcm90b3R5cGUuYXNzaWduUm9sZXMgPSBmdW5jdGlvbigpIHtcbiAgICAvLyBwbGF5ZXJzICAgIDUgNiA3IDggOSAxMFxuICAgIC8vIHJlc2lzdGFuY2UgMyA0IDQgNSA2IDZcbiAgICAvLyBzcHkgICAgICAgIDIgMiAzIDMgMyA0XG4gICAgLy8gdmFyIHJlc2lzdGFuY2UgPSB7NTogMywgNjogNCwgNzogNCwgODogNSwgOTogNiwgMTA6IDYsfVxuXG4gICAgdmFyIG51bVBsYXllcnMgPSB0aGlzLnBsYXllck5hbWVzLmxlbmd0aFxuICAgIHZhciBudW1TcGllcyA9IHs1OiAyLCA2OiAyLCA3OiAzLCA4OiAzLCA5OiAzLCAxMDogNCx9W251bVBsYXllcnNdXG4gICAgdmFyIHNodWZmbGVkTmFtZXMgPSBfLnNodWZmbGUodGhpcy5wbGF5ZXJOYW1lcylcblxuICAgIC8vIEFzc2lnbiBpbml0aWFsIHJvbGVzXG4gICAgdGhpcy5yb2xlcyA9IHt9XG4gICAgc2h1ZmZsZWROYW1lcy5mb3JFYWNoKChuYW1lLCBpKSA9PiB7XG4gICAgICAgIHRoaXMucm9sZXNbbmFtZV0gPSB7XG4gICAgICAgICAgICBzcHk6IGkgPCBudW1TcGllcyxcbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBLZWVwIHRyYWNrIG9mIHBsYXllcnMgd2hvIGhhdmVuJ3QgYmVlbiBhc3NpZ25lZCBzcGVjaWFsIHJvbGVzXG4gICAgdmFyIHVuYXNzaWduZWRTcGllcyA9IHNodWZmbGVkTmFtZXMuc2xpY2UoMCwgbnVtU3BpZXMpO1xuICAgIHZhciB1bmFzc2lnbmVkUmVzaXN0YW5jZSA9IHNodWZmbGVkTmFtZXMuc2xpY2UobnVtU3BpZXMpO1xuXG4gICAgaWYgKHRoaXMuc2V0dGluZ3MubWVybGluKSB7XG4gICAgICAgIHZhciBtZXJsaW5OYW1lID0gdW5hc3NpZ25lZFJlc2lzdGFuY2VbMF07XG4gICAgICAgIHVuYXNzaWduZWRSZXNpc3RhbmNlLnNwbGljZSgwLDEpO1xuICAgICAgICB0aGlzLnJvbGVzW21lcmxpbk5hbWVdLm1lcmxpbiA9IHRydWU7XG4gICAgfVxuICAgIGlmICh0aGlzLnNldHRpbmdzLm1vcmdhbmEpIHtcbiAgICAgICAgdmFyIG1vcmdhbmFOYW1lID0gdW5hc3NpZ25lZFNwaWVzWzBdO1xuICAgICAgICB1bmFzc2lnbmVkU3BpZXMuc3BsaWNlKDAsMSk7XG4gICAgICAgIHRoaXMucm9sZXNbbW9yZ2FuYU5hbWVdLm1vcmdhbmEgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAodGhpcy5zZXR0aW5ncy5wZXJjaXZhbCkge1xuICAgICAgICB2YXIgcGVyY2l2YWxOYW1lID0gdW5hc3NpZ25lZFJlc2lzdGFuY2VbMF07XG4gICAgICAgIHVuYXNzaWduZWRSZXNpc3RhbmNlLnNwbGljZSgwLDEpO1xuICAgICAgICB0aGlzLnJvbGVzW3BlcmNpdmFsTmFtZV0ucGVyY2l2YWwgPSB0cnVlO1xuICAgIH1cbiAgICBpZiAodGhpcy5zZXR0aW5ncy5tb3JkcmVkKSB7XG4gICAgICAgIHZhciBtb3JkcmVkTmFtZSA9IHVuYXNzaWduZWRTcGllc1swXTtcbiAgICAgICAgdW5hc3NpZ25lZFNwaWVzLnNwbGljZSgwLDEpO1xuICAgICAgICB0aGlzLnJvbGVzW21vcmRyZWROYW1lXS5tb3JkcmVkID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mub2Jlcm9uKSB7XG4gICAgICAgIHZhciBvYmVyb25OYW1lID0gdW5hc3NpZ25lZFNwaWVzWzBdO1xuICAgICAgICB1bmFzc2lnbmVkU3BpZXMuc3BsaWNlKDAsMSk7XG4gICAgICAgIHRoaXMucm9sZXNbb2Jlcm9uTmFtZV0ub2Jlcm9uID0gdHJ1ZTtcbiAgICB9XG5cbiAgICB0aGlzLmVtaXRDaGFuZ2UoKVxufVxuXG4vKipcbiAqIE1ha2Ugc3VyZSB0aGF0IHJvbGVzIGV4aXN0IGlmIHRoZXkgY2FuLlxuICogY2xlYXIgLSB3aGV0aGVyIHRvIGNsZWFyIGV4aXN0aW5nIHJvbGVzXG4gKi9cbkdhbWVTdGF0ZS5wcm90b3R5cGUudXBkYXRlUm9sZXMgPSBmdW5jdGlvbihjbGVhcikge1xuICAgIGlmIChjbGVhcikge1xuICAgICAgICB0aGlzLnJvbGVzID0gbnVsbFxuICAgIH1cblxuICAgIC8vIFVzZSBleGlzdGluZyByb2xlcyBpZiB0aGV5IHN0aWxsIGV4aXN0LlxuICAgIGlmICh0aGlzLnJvbGVzICE9PSBudWxsKSByZXR1cm5cblxuICAgIGlmICh0aGlzLnBsYXllck5hbWVzLmxlbmd0aCA8IDUpIHtcbiAgICAgICAgdGhpcy5kaXNhYmxlZFJlYXNvbiA9ICd0b29GZXcnXG4gICAgfSBlbHNlIGlmICh0aGlzLnBsYXllck5hbWVzLmxlbmd0aCA+IDEwKSB7XG4gICAgICAgIHRoaXMuZGlzYWJsZWRSZWFzb24gPSAndG9vTWFueSdcbiAgICB9IGVsc2UgaWYgKHRoaXMucGxheWVyTmFtZXMubGVuZ3RoIDwgN1xuICAgICAgICAgICAgJiYgdGhpcy5zZXR0aW5ncy5tb3JkcmVkXG4gICAgICAgICAgICAmJiB0aGlzLnNldHRpbmdzLm1vcmdhbmFcbiAgICAgICAgICAgICYmIHRoaXMuc2V0dGluZ3Mub2Jlcm9uKSB7XG4gICAgICAgIHRoaXMuZGlzYWJsZWRSZWFzb24gPSAndG9vRmV3J1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZGlzYWJsZWRSZWFzb24gPSBudWxsXG4gICAgICAgIHRoaXMuYXNzaWduUm9sZXMoKVxuICAgIH1cbn1cblxuR2FtZVN0YXRlLmFjdGlvbnMgPSB7fVxuXG5HYW1lU3RhdGUuYWN0aW9ucy5hZGRQbGF5ZXIgPSBmdW5jdGlvbih7bmFtZX0pIHtcbiAgICBpZiAoIV8uY29udGFpbnModGhpcy5wbGF5ZXJOYW1lcywgbmFtZSkpIHtcbiAgICAgICAgdGhpcy5wbGF5ZXJOYW1lcy5wdXNoKG5hbWUpXG4gICAgICAgIHRoaXMudXBkYXRlUm9sZXModHJ1ZSlcbiAgICAgICAgdGhpcy5lbWl0Q2hhbmdlKClcbiAgICB9XG59XG5cbkdhbWVTdGF0ZS5hY3Rpb25zLmRlbGV0ZVBsYXllciA9IGZ1bmN0aW9uKHtuYW1lfSkge1xuICAgIHRoaXMucGxheWVyTmFtZXMgPSBfLndpdGhvdXQodGhpcy5wbGF5ZXJOYW1lcywgbmFtZSlcbiAgICB0aGlzLnVwZGF0ZVJvbGVzKHRydWUpXG4gICAgdGhpcy5lbWl0Q2hhbmdlKClcbn1cblxuR2FtZVN0YXRlLmFjdGlvbnMuY2hhbmdlU2V0dGluZ3MgPSBmdW5jdGlvbih7c2V0dGluZ3N9KSB7XG4gICAgXy5leHRlbmQodGhpcy5zZXR0aW5ncywgc2V0dGluZ3MpXG4gICAgdGhpcy51cGRhdGVSb2xlcyh0cnVlKVxuICAgIHRoaXMuZW1pdENoYW5nZSgpXG59XG5cbkdhbWVTdGF0ZS5hY3Rpb25zLm5ld1JvbGVzID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy51cGRhdGVSb2xlcyh0cnVlKVxufVxuIiwidmFyIFRhYnMgPSByZXF1aXJlKCcuL3RhYnMuanN4JylcbnZhciBTZXR1cFBhZ2UgPSByZXF1aXJlKCcuL3NldHVwLXBhZ2UuanN4JylcbnZhciBSb2xlc1BhZ2UgPSByZXF1aXJlKCcuL3JvbGVzLXBhZ2UuanN4JylcbnZhciBNaXNzaW9uUGFnZSA9IHJlcXVpcmUoJy4vbWlzc2lvbi1wYWdlLmpzeCcpXG52YXIgRGlzcGF0Y2hlciA9IHJlcXVpcmUoJy4vZGlzcGF0Y2hlcicpXG52YXIgVUlTdGF0ZSA9IHJlcXVpcmUoJy4vdWktc3RhdGUnKVxudmFyIEdhbWVTdGF0ZSA9IHJlcXVpcmUoJy4vZ2FtZS1zdGF0ZScpXG52YXIgTWlzc2lvblN0YXRlID0gcmVxdWlyZSgnLi9taXNzaW9uLXN0YXRlJylcbnZhciBzdG9yZV9yZXNldCA9IHJlcXVpcmUoJy4vc3RvcmUtcmVzZXQnKVxuXG52YXIgZGlzcGF0Y2hlciA9IG5ldyBEaXNwYXRjaGVyKClcbnZhciBkaXNwYXRjaCA9IGRpc3BhdGNoZXIuZGlzcGF0Y2guYmluZChkaXNwYXRjaGVyKVxudmFyIHVpc3RhdGUgPSBuZXcgVUlTdGF0ZShkaXNwYXRjaGVyKVxudmFyIGdhbWVzdGF0ZSA9IG5ldyBHYW1lU3RhdGUoZGlzcGF0Y2hlcilcbnZhciBtaXNzaW9uc3RhdGUgPSBuZXcgTWlzc2lvblN0YXRlKGRpc3BhdGNoZXIpXG5cbi8vIEluY3JlYXNlIHRoaXMgbnVtYmVyIGFmdGVyIGV2ZXJ5IGRhdGFzdG9yZSBzY2hlbWEgYnJlYWtpbmcgY2hhbmdlLlxuc3RvcmVfcmVzZXQoMylcbnVpc3RhdGUubG9hZCgpXG5nYW1lc3RhdGUubG9hZCgpXG5taXNzaW9uc3RhdGUubG9hZCgpXG5cbnZhciByZW5kZXJBcHAgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2V0dXBQYWdlID0gU2V0dXBQYWdlKHtcbiAgICAgICAgcGxheWVyTmFtZXM6IGdhbWVzdGF0ZS5wbGF5ZXJOYW1lcywgc2V0dGluZ3M6IGdhbWVzdGF0ZS5zZXR0aW5ncyxcbiAgICAgICAgb25BZGROYW1lOiBkaXNwYXRjaGVyLmJha2UoJ2FkZFBsYXllcicsICduYW1lJyksXG4gICAgICAgIG9uRGVsZXRlTmFtZTogZGlzcGF0Y2hlci5iYWtlKCdkZWxldGVQbGF5ZXInLCAnbmFtZScpLFxuICAgICAgICBvbkNoYW5nZVNldHRpbmdzOiBkaXNwYXRjaGVyLmJha2UoJ2NoYW5nZVNldHRpbmdzJywgJ3NldHRpbmdzJyksXG4gICAgICAgIG9uTmV3Um9sZXM6IGRpc3BhdGNoZXIuYmFrZSgnbmV3Um9sZXMnKSxcbiAgICB9KVxuXG4gICAgdmFyIHJvbGVzUGFnZSA9IFJvbGVzUGFnZSh7XG4gICAgICAgIGRpc2FibGVkUmVhc29uOiBnYW1lc3RhdGUuZGlzYWJsZWRSZWFzb24sXG4gICAgICAgIHBsYXllck5hbWVzOiBnYW1lc3RhdGUucGxheWVyTmFtZXMsXG4gICAgICAgIHNlbGVjdGVkUGxheWVyOiB1aXN0YXRlLnNlbGVjdGVkUGxheWVyLFxuICAgICAgICBzZWxlY3RlZFJvbGU6ICAgZ2FtZXN0YXRlLmdldFJvbGUodWlzdGF0ZS5zZWxlY3RlZFBsYXllciksXG4gICAgICAgIHNlbGVjdGlvbkNvbmZpcm1lZDogdWlzdGF0ZS5zZWxlY3Rpb25Db25maXJtZWQsXG4gICAgICAgIG9uQ2xpY2tTaG93OiAgICBkaXNwYXRjaGVyLmJha2UoJ3NlbGVjdFBsYXllcicsICduYW1lJyksXG4gICAgICAgIG9uQ2xpY2tDb25maXJtOiBkaXNwYXRjaGVyLmJha2UoJ2NvbmZpcm1QbGF5ZXInLCAnbmFtZScpLFxuICAgICAgICBvbkNsaWNrQ2FuY2VsOiAgZGlzcGF0Y2hlci5iYWtlKCdkZXNlbGVjdFBsYXllcicpLFxuICAgICAgICBvbkNsaWNrT2s6ICAgICAgZGlzcGF0Y2hlci5iYWtlKCdkZXNlbGVjdFBsYXllcicsICduYW1lJyksXG4gICAgfSlcblxuICAgIHZhciBtaXNzaW9uUGFnZSA9IE1pc3Npb25QYWdlKHtcbiAgICAgICAgbnVtUGxheWVyczogZ2FtZXN0YXRlLnBsYXllck5hbWVzLmxlbmd0aCxcbiAgICAgICAgcGFzc2VzOiBtaXNzaW9uc3RhdGUucGFzc2VzLFxuICAgICAgICBmYWlsczogbWlzc2lvbnN0YXRlLmZhaWxzLFxuICAgICAgICBoaXN0b3J5OiBtaXNzaW9uc3RhdGUuaGlzdG9yeSxcbiAgICAgICAgcmV2ZWFsZWQ6IHVpc3RhdGUubWlzc2lvblJldmVhbGVkLFxuICAgICAgICBvblZvdGU6IGRpc3BhdGNoZXIuYmFrZSgnbWlzc2lvblZvdGUnLCAncGFzcycpLFxuICAgICAgICBvblJldmVhbDogZGlzcGF0Y2hlci5iYWtlKCdtaXNzaW9uUmV2ZWFsJyksXG4gICAgICAgIG9uUmVzZXQ6IGRpc3BhdGNoZXIuYmFrZSgnbWlzc2lvblJlc2V0JyksXG4gICAgfSlcblxuICAgIFJlYWN0LnJlbmRlckNvbXBvbmVudChcbiAgICAgICAgVGFicyh7XG4gICAgICAgICAgICBhY3RpdmVUYWI6IHVpc3RhdGUudGFiLFxuICAgICAgICAgICAgb25DaGFuZ2VUYWI6IGRpc3BhdGNoZXIuYmFrZSgnY2hhbmdlVGFiJywgJ3RhYicpLFxuICAgICAgICAgICAgdGFiczoge1xuICAgICAgICAgICAgICAgIHNldHVwOiB7bmFtZTogJ1NldHVwJywgY29udGVudDogc2V0dXBQYWdlfSxcbiAgICAgICAgICAgICAgICByb2xlczoge25hbWU6ICdSb2xlcycsIGNvbnRlbnQ6IHJvbGVzUGFnZX0sXG4gICAgICAgICAgICAgICAgbWlzc2lvbjoge25hbWU6ICdNaXNzaW9uJywgY29udGVudDogbWlzc2lvblBhZ2V9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FwcCcpXG4gICAgKVxufVxuXG5yZW5kZXJBcHAoKVxudWlzdGF0ZS5vbkNoYW5nZShyZW5kZXJBcHApXG5nYW1lc3RhdGUub25DaGFuZ2UocmVuZGVyQXBwKVxubWlzc2lvbnN0YXRlLm9uQ2hhbmdlKHJlbmRlckFwcClcblxuLy8gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyBsb2NhdGlvbi5yZWxvYWQoKVxuLy8gfSwgMjAwMClcbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgUFQgPSBSZWFjdC5Qcm9wVHlwZXNcbnZhciBjeCA9IFJlYWN0LmFkZG9ucy5jbGFzc1NldFxuXG52YXIgTGFiZWxlZE51bWJlciA9IFJlYWN0LmNyZWF0ZUNsYXNzKHtkaXNwbGF5TmFtZTogJ0xhYmVsZWROdW1iZXInLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBudW06IFBULm51bWJlci5pc1JlcXVpcmVkLFxuICAgICAgICBuYW1lOiBQVC5zdHJpbmcuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS5maWd1cmUoe2NsYXNzTmFtZTogXCJsYWJlbGVkLW51bWJlclwifSwgXG4gICAgICAgICAgICB0aGlzLnByb3BzLm51bSwgXG4gICAgICAgICAgICBSZWFjdC5ET00uZmlnY2FwdGlvbihudWxsLCB0aGlzLnByb3BzLm5hbWUpXG4gICAgICAgIClcbiAgICB9LFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gTGFiZWxlZE51bWJlclxuIiwiLyoqIEBqc3ggUmVhY3QuRE9NICovXG5cbnZhciBMYWJlbGVkTnVtYmVyID0gcmVxdWlyZSgnLi9sYWJlbGVkLW51bWJlci5qc3gnKVxudmFyIFBUID0gUmVhY3QuUHJvcFR5cGVzXG52YXIgY3ggPSBSZWFjdC5hZGRvbnMuY2xhc3NTZXRcblxudmFyIE1pc3Npb25QYWdlID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnTWlzc2lvblBhZ2UnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBudW1QbGF5ZXJzOiBQVC5udW1iZXIuaXNSZXF1aXJlZCxcbiAgICAgICAgcGFzc2VzOiBQVC5udW1iZXIuaXNSZXF1aXJlZCxcbiAgICAgICAgZmFpbHM6ICBQVC5udW1iZXIuaXNSZXF1aXJlZCxcbiAgICAgICAgaGlzdG9yeTogUFQuYXJyYXkuaXNSZXF1aXJlZCxcbiAgICAgICAgcmV2ZWFsZWQ6ICBQVC5ib29sLmlzUmVxdWlyZWQsXG4gICAgICAgIG9uVm90ZTogIFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25SZXNldDogIFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25SZXZlYWw6ICBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgfSxcblxuICAgIHJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBtaXNzaW9uTnVtYmVycyA9IHRoaXMucmVuZGVyTWlzc2lvbk51bWJlcnMoKVxuICAgICAgICBpZiAodGhpcy5wcm9wcy5yZXZlYWxlZCkge1xuICAgICAgICAgICAgdmFyIHBhc3NMYWJlbCA9IHRoaXMucHJvcHMucGFzc2VzID09PSAxID8gXCJQYXNzXCIgOiBcIlBhc3Nlc1wiXG4gICAgICAgICAgICB2YXIgZmFpbExhYmVsID0gdGhpcy5wcm9wcy5mYWlscyA9PT0gMSA/IFwiRmFpbFwiIDogXCJGYWlsc1wiXG5cbiAgICAgICAgICAgIHJldHVybiBSZWFjdC5ET00uZGl2KHtjbGFzc05hbWU6IFwibWlzc2lvbi1wYWdlIHJldmVhbGVkXCJ9LCBcbiAgICAgICAgICAgICAgICBtaXNzaW9uTnVtYmVycywgXG4gICAgICAgICAgICAgICAgUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcInZvdGUtaG9sZGVyXCJ9LCBcbiAgICAgICAgICAgICAgICAgICAgTGFiZWxlZE51bWJlcih7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBwYXNzTGFiZWwsIFxuICAgICAgICAgICAgICAgICAgICAgICAgbnVtOiB0aGlzLnByb3BzLnBhc3Nlc30pLCBcbiAgICAgICAgICAgICAgICAgICAgTGFiZWxlZE51bWJlcih7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBmYWlsTGFiZWwsIFxuICAgICAgICAgICAgICAgICAgICAgICAgbnVtOiB0aGlzLnByb3BzLmZhaWxzfSlcbiAgICAgICAgICAgICAgICApLCBcbiAgICAgICAgICAgICAgICBSZWFjdC5ET00uYnV0dG9uKHtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBcInJlc2V0XCIsIFxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrOiB0aGlzLnByb3BzLm9uUmVzZXR9LCBcbiAgICAgICAgICAgICAgICAgICAgXCJSZXNldFwiKVxuICAgICAgICAgICAgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFyIHZvdGVzID0gdGhpcy5wcm9wcy5wYXNzZXMgKyB0aGlzLnByb3BzLmZhaWxzXG4gICAgICAgICAgICBNYXRoLnJhbmRvbSgpXG4gICAgICAgICAgICB2YXIgc2lkZSA9IE1hdGgucmFuZG9tKCkgPiAwLjVcbiAgICAgICAgICAgIHJldHVybiBSZWFjdC5ET00uZGl2KHtjbGFzc05hbWU6IFwibWlzc2lvbi1wYWdlXCJ9LCBcbiAgICAgICAgICAgICAgICBtaXNzaW9uTnVtYmVycywgXG4gICAgICAgICAgICAgICAgTGFiZWxlZE51bWJlcih7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IFwiVm90ZXNcIiwgXG4gICAgICAgICAgICAgICAgICAgIG51bTogdm90ZXN9KSwgXG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJWb3RlQnV0dG9uKHNpZGUpLCBcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlclZvdGVCdXR0b24oIXNpZGUpLCBcbiAgICAgICAgICAgICAgICBSZWFjdC5ET00uYnV0dG9uKHtcbiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBcInJlc2V0XCIsIFxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrOiB0aGlzLnByb3BzLm9uUmVzZXR9LCBcbiAgICAgICAgICAgICAgICAgICAgXCJSZXNldFwiKSwgXG4gICAgICAgICAgICAgICAgUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcInJldmVhbC1jb250YWluZXJcIn0sIFxuICAgICAgICAgICAgICAgICAgICBSZWFjdC5ET00uYnV0dG9uKHtjbGFzc05hbWU6IFwicmV2ZWFsXCIsIFxuICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljazogdGhpcy5wcm9wcy5vblJldmVhbH0sIFxuICAgICAgICAgICAgICAgICAgICAgICAgXCJTaG93IFZvdGVzXCIpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHJlbmRlck1pc3Npb25OdW1iZXJzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBsYXllckNvdW50c01hcHBpbmcgPSB7XG4gICAgICAgICAgICA1OiBbXCIyXCIsIFwiM1wiLCBcIjJcIiwgXCIzXCIsIFwiM1wiXSxcbiAgICAgICAgICAgIDY6IFtcIjJcIiwgXCIzXCIsIFwiNFwiLCBcIjNcIiwgXCI0XCJdLFxuICAgICAgICAgICAgNzogW1wiMlwiLCBcIjNcIiwgXCIzXCIsIFwiNCpcIiwgXCI0XCJdLFxuICAgICAgICAgICAgODogW1wiM1wiLCBcIjRcIiwgXCI0XCIsIFwiNSpcIiwgXCI1XCJdLFxuICAgICAgICAgICAgOTogW1wiM1wiLCBcIjRcIiwgXCI0XCIsIFwiNSpcIiwgXCI1XCJdLFxuICAgICAgICAgICAgMTA6IFtcIjNcIiwgXCI0XCIsIFwiNFwiLCBcIjUqXCIsIFwiNVwiXSxcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGxheWVyQ291bnRzID0gcGxheWVyQ291bnRzTWFwcGluZ1t0aGlzLnByb3BzLm51bVBsYXllcnNdXG4gICAgICAgIHZhciBoaXN0b3J5ID0gdGhpcy5wcm9wcy5oaXN0b3J5XG5cbiAgICAgICAgaWYgKHBsYXllckNvdW50cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGRpZ2l0cyA9IHBsYXllckNvdW50cy5tYXAoZnVuY3Rpb24obiwgaSkge1xuICAgICAgICAgICAgdmFyIHBsYXllZCA9IGhpc3RvcnkubGVuZ3RoID4gaVxuICAgICAgICAgICAgdmFyIHBhc3NlZCA9IGhpc3RvcnlbaV09PTAgfHwgKGhpc3RvcnlbaV09PTEgJiYgcGxheWVyQ291bnRzW2ldLmluZGV4T2YoXCIqXCIpIT0tMSlcbiAgICAgICAgICAgIHJldHVybiBSZWFjdC5ET00uc3Bhbih7a2V5OiBpLCBjbGFzc05hbWU6IGN4KHtcbiAgICAgICAgICAgICAgICAncGFzcyc6IHBsYXllZCAmJiBwYXNzZWQsXG4gICAgICAgICAgICAgICAgJ2ZhaWwnOiBwbGF5ZWQgJiYgIXBhc3NlZCxcbiAgICAgICAgICAgICAgICAnY3VycmVudCc6IGhpc3RvcnkubGVuZ3RoID09PWksXG4gICAgICAgICAgICAgICAgJ251bSc6IHRydWUsXG4gICAgICAgICAgICB9KX0sIHBsYXllckNvdW50c1tpXSlcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcIm1pc3Npb24tbnVtYmVyc1wifSwgXG4gICAgICAgICAgICBkaWdpdHNcbiAgICAgICAgKVxuICAgIH0sXG5cbiAgICByZW5kZXJWb3RlQnV0dG9uOiBmdW5jdGlvbihwYXNzKSB7XG4gICAgICAgIHZhciBsYWJlbCA9IHBhc3MgPyBcIlBhc3NcIiA6IFwiRmFpbFwiXG4gICAgICAgIHJldHVybiBSZWFjdC5ET00uZGl2KHtrZXk6IGxhYmVsLCBjbGFzc05hbWU6IFwidm90ZS1jb250YWluZXJcIn0sIFxuICAgICAgICAgICAgUmVhY3QuRE9NLmJ1dHRvbih7XG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lOiBjeCh7XG4gICAgICAgICAgICAgICAgICAgICdwYXNzJzogcGFzcyxcbiAgICAgICAgICAgICAgICAgICAgJ2ZhaWwnOiAhcGFzcyxcbiAgICAgICAgICAgICAgICAgICAgJ3NlY3JldC1mb2N1cyc6IHRydWUsXG4gICAgICAgICAgICAgICAgfSksIFxuICAgICAgICAgICAgICAgICdkYXRhLXBhc3MnOiBwYXNzLCBcbiAgICAgICAgICAgICAgICBvbkNsaWNrOiB0aGlzLm9uVm90ZX0sIFxuICAgICAgICAgICAgICAgIGxhYmVsKVxuICAgICAgICApXG4gICAgfSxcblxuICAgIG9uVm90ZTogZnVuY3Rpb24oZSkge1xuICAgICAgICB2YXIgcGFzcyA9IGUudGFyZ2V0LmRhdGFzZXQucGFzcyA9PT0gXCJ0cnVlXCJcbiAgICAgICAgdGhpcy5wcm9wcy5vblZvdGUocGFzcylcbiAgICB9LFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWlzc2lvblBhZ2VcbiIsInZhciBTdG9yZSA9IHJlcXVpcmUoJy4vc3RvcmUnKVxuXG5tb2R1bGUuZXhwb3J0cyA9IE1pc3Npb25TdGF0ZVxuXG5mdW5jdGlvbiBNaXNzaW9uU3RhdGUoZGlzcGF0Y2hlcikge1xuICAgIFN0b3JlLm1peGluKHRoaXMpXG5cbiAgICB0aGlzLnBhc3NlcyA9IDBcbiAgICB0aGlzLmZhaWxzID0gMFxuICAgIHRoaXMuaGlzdG9yeSA9IFtdXG5cbiAgICBkaXNwYXRjaGVyLm9uQWN0aW9uKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAgICAgICAgdmFyIGFjdGlvbnMgPSBNaXNzaW9uU3RhdGUuYWN0aW9uc1xuICAgICAgICBpZiAoXy5pc0Z1bmN0aW9uKGFjdGlvbnNbcGF5bG9hZC5hY3Rpb25dKSkge1xuICAgICAgICAgICAgYWN0aW9uc1twYXlsb2FkLmFjdGlvbl0uY2FsbCh0aGlzLCBwYXlsb2FkKVxuICAgICAgICAgICAgdGhpcy5zYXZlKClcbiAgICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSlcbn1cblxudmFyIFBFUlNJU1RfS0VZUyA9IFsncGFzc2VzJywgJ2ZhaWxzJywgJ2hpc3RvcnknXVxuXG5NaXNzaW9uU3RhdGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGVyc2lzdCA9IHt9XG4gICAgUEVSU0lTVF9LRVlTLmZvckVhY2goa2V5ID0+IHBlcnNpc3Rba2V5XSA9IHRoaXNba2V5XSlcbiAgICBzdG9yZS5zZXQoJ3N0b3JlLm1pc3Npb25zdGF0ZScsIHBlcnNpc3QpXG59XG5cbk1pc3Npb25TdGF0ZS5wcm90b3R5cGUubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwZXJzaXN0ID0gc3RvcmUuZ2V0KCdzdG9yZS5taXNzaW9uc3RhdGUnKVxuICAgIGlmIChwZXJzaXN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgUEVSU0lTVF9LRVlTLmZvckVhY2goa2V5ID0+IHRoaXNba2V5XSA9IHBlcnNpc3Rba2V5XSlcbiAgICB9XG59XG5cbk1pc3Npb25TdGF0ZS5wcm90b3R5cGUucmVzZXRNaXNzaW9uID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5wYXNzZXMgPSAwXG4gICAgdGhpcy5mYWlscyA9IDBcbiAgICB0aGlzLmVtaXRDaGFuZ2UoKVxufVxuXG5NaXNzaW9uU3RhdGUucHJvdG90eXBlLnJlc2V0TWlzc2lvbkhpc3RvcnkgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkgPSBbXVxuICAgIHRoaXMucmVzZXRNaXNzaW9uKClcbn1cblxuTWlzc2lvblN0YXRlLmFjdGlvbnMgPSB7fVxuXG5NaXNzaW9uU3RhdGUuYWN0aW9ucy5taXNzaW9uVm90ZSA9IGZ1bmN0aW9uKHtwYXNzfSkge1xuICAgIGlmIChwYXNzKSB7XG4gICAgICAgIHRoaXMucGFzc2VzICs9IDFcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmZhaWxzICs9IDFcbiAgICB9XG4gICAgdGhpcy5lbWl0Q2hhbmdlKClcbn1cblxuTWlzc2lvblN0YXRlLmFjdGlvbnMubWlzc2lvblJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yZXNldE1pc3Npb24oKVxufVxuXG5NaXNzaW9uU3RhdGUuYWN0aW9ucy5hZGRQbGF5ZXIgPSBmdW5jdGlvbih7bmFtZX0pIHtcbiAgICB0aGlzLnJlc2V0TWlzc2lvbkhpc3RvcnkoKVxufVxuXG5NaXNzaW9uU3RhdGUuYWN0aW9ucy5kZWxldGVQbGF5ZXIgPSBmdW5jdGlvbih7bmFtZX0pIHtcbiAgICB0aGlzLnJlc2V0TWlzc2lvbkhpc3RvcnkoKVxufVxuXG5NaXNzaW9uU3RhdGUuYWN0aW9ucy5jaGFuZ2VTZXR0aW5ncyA9IGZ1bmN0aW9uKHtzZXR0aW5nc30pIHtcbiAgICB0aGlzLnJlc2V0TWlzc2lvbkhpc3RvcnkoKVxufVxuXG5NaXNzaW9uU3RhdGUuYWN0aW9ucy5uZXdSb2xlcyA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVzZXRNaXNzaW9uSGlzdG9yeSgpXG59XG5cbk1pc3Npb25TdGF0ZS5hY3Rpb25zLm1pc3Npb25SZXZlYWwgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucHVzaCh0aGlzLmZhaWxzKVxufVxuIiwiLyoqIEBqc3ggUmVhY3QuRE9NICovXG5cbnZhciBjb2xvclN0eWxlRm9yUGxheWVyID0gcmVxdWlyZSgnLi9jb2xvci5qcycpXG52YXIgUFQgPSBSZWFjdC5Qcm9wVHlwZXNcbnZhciBjeCA9IFJlYWN0LmFkZG9ucy5jbGFzc1NldFxuXG52YXIgTmFtZWxldCA9IFJlYWN0LmNyZWF0ZUNsYXNzKHtkaXNwbGF5TmFtZTogJ05hbWVsZXQnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBuYW1lOiBQVC5zdHJpbmcuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG5hbWUgPSB0aGlzLnByb3BzLm5hbWVcbiAgICAgICAgdmFyIHN0eWxlcyA9IHsnbmFtZWxldCc6IHRydWV9XG4gICAgICAgIGlmICh0aGlzLnByb3BzLm5hbWUgIT09IFwiXCIpIHtcbiAgICAgICAgICAgIHN0eWxlc1tjb2xvclN0eWxlRm9yUGxheWVyKG5hbWUpXSA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBjeChzdHlsZXMpfSwgbmFtZVswXSlcbiAgICB9LFxuXG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBOYW1lbGV0XG4iLCIvKiogQGpzeCBSZWFjdC5ET00gKi9cblxudmFyIE5hbWVsZXQgPSByZXF1aXJlKCcuL25hbWVsZXQuanN4JylcbnZhciBQVCA9IFJlYWN0LlByb3BUeXBlc1xuXG52YXIgTmV3TmFtZSA9IFJlYWN0LmNyZWF0ZUNsYXNzKHtkaXNwbGF5TmFtZTogJ05ld05hbWUnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBvbkFkZE5hbWU6IFBULmZ1bmMsXG4gICAgfSxcblxuICAgIGdldEluaXRpYWxTdGF0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB7dGV4dDogJyd9XG4gICAgfSxcblxuICAgIHJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBSZWFjdC5ET00uZm9ybSh7Y2xhc3NOYW1lOiBcIm5ldy1wbGF5ZXJcIiwgb25TdWJtaXQ6IHRoaXMub25TdWJtaXR9LCBcbiAgICAgICAgICAgIE5hbWVsZXQoe25hbWU6IHRoaXMuc3RhdGUudGV4dH0pLCBcbiAgICAgICAgICAgIFJlYWN0LkRPTS5pbnB1dCh7dHlwZTogXCJuYW1lXCIsIFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogXCJuYW1lXCIsIFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLnN0YXRlLnRleHQsIFxuICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkFub3RoZXIgUGxheWVyXCIsIFxuICAgICAgICAgICAgICAgIGF1dG9DYXBpdGFsaXplOiBcIm9uXCIsIFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiB0aGlzLm9uQ2hhbmdlXG4gICAgICAgICAgICAgICAgfSksIFxuICAgICAgICAgICAgUmVhY3QuRE9NLmJ1dHRvbih7Y2xhc3NOYW1lOiBcIm5ldy1wbGF5ZXJcIn0sIFxuICAgICAgICAgICAgICAgIFwiQWRkXCIpXG4gICAgICAgIClcbiAgICB9LFxuXG4gICAgb25DaGFuZ2U6IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgdmFyIG5hbWUgPSBlLnRhcmdldC52YWx1ZVxuICAgICAgICBuYW1lID0gbmFtZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIG5hbWUuc2xpY2UoMSksXG4gICAgICAgIHRoaXMuc2V0U3RhdGUoe3RleHQ6IG5hbWV9KVxuICAgIH0sXG5cbiAgICBvblN1Ym1pdDogZnVuY3Rpb24oZSkge1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KClcbiAgICAgICAgaWYgKHRoaXMuc3RhdGUudGV4dCAhPSBcIlwiKSB7XG4gICAgICAgICAgICB0aGlzLnByb3BzLm9uQWRkTmFtZSh0aGlzLnN0YXRlLnRleHQpXG4gICAgICAgICAgICB0aGlzLnNldFN0YXRlKHt0ZXh0OiBcIlwifSlcbiAgICAgICAgfVxuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE5ld05hbWVcbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgTmFtZWxldCA9IHJlcXVpcmUoJy4vbmFtZWxldC5qc3gnKVxudmFyIFBUID0gUmVhY3QuUHJvcFR5cGVzXG5cbnZhciBQbGF5ZXJDaGlwID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnUGxheWVyQ2hpcCcsXG4gICAgcHJvcFR5cGVzOiB7XG4gICAgICAgIG5hbWU6IFBULnN0cmluZy5pc1JlcXVpcmVkLFxuICAgIH0sXG5cbiAgICByZW5kZXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcInBsYXllci1jaGlwXCJ9LCBcbiAgICAgICAgICAgIE5hbWVsZXQoe25hbWU6IHRoaXMucHJvcHMubmFtZX0pLCBcbiAgICAgICAgICAgIFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwibmFtZVwifSwgdGhpcy5wcm9wcy5uYW1lKVxuICAgICAgICApXG4gICAgfSxcbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBsYXllckNoaXBcbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgUFQgPSBSZWFjdC5Qcm9wVHlwZXNcblxudmFyIFJvbGVDYXJkID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnUm9sZUNhcmQnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBwbGF5ZXJOYW1lOiBQVC5zdHJpbmcuaXNSZXF1aXJlZCxcbiAgICAgICAgcm9sZTogUFQub2JqZWN0LmlzUmVxdWlyZWQsXG4gICAgfSxcblxuICAgIHJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByb2xlID0gdGhpcy5wcm9wcy5yb2xlXG4gICAgICAgIHZhciBjb250ZW50cyA9IG51bGxcblxuICAgICAgICB2YXIgdGhlU3BpZXMgPSByb2xlLnNwaWVzIHx8IHJvbGUub3RoZXJTcGllcyB8fCBbXTtcbiAgICAgICAgdmFyIHNwaWVzVGV4dCA9IHRoZVNwaWVzLmpvaW4oJywgJylcbiAgICAgICAgdmFyIHNweU5vdW4gPSB0aGVTcGllcy5sZW5ndGggPT0gMSA/IFwic3B5XCIgOiBcInNwaWVzXCJcbiAgICAgICAgdmFyIHNweVZlcmIgPSB0aGVTcGllcy5sZW5ndGggPT0gMSA/IFwiaXNcIiA6IFwiYXJlXCJcbiAgICAgICAgdmFyIG90aGVyID0gcm9sZS5zcHk/IFwib3RoZXJcIiA6IFwiXCJcbiAgICAgICAgdmFyIG9iZXJvblRleHQgPSByb2xlLmhhc09iZXJvbj8gUmVhY3QuRE9NLnNwYW4obnVsbCwgUmVhY3QuRE9NLmJyKG51bGwpLCBSZWFjdC5ET00uc3Bhbih7Y2xhc3NOYW1lOiBcInNweVwifSwgXCJPYmVyb25cIiksIFwiIGlzIGhpZGRlbiBmcm9tIHlvdS5cIikgOiAnJ1xuICAgICAgICB2YXIgc3BpZXNCbG9jayA9IHRoZVNwaWVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICA/IFJlYWN0LkRPTS5wKG51bGwsIFwiVGhlIFwiLCBvdGhlciwgXCIgXCIsIHNweU5vdW4sIFwiIFwiLCBzcHlWZXJiLCBcIiBcIiwgUmVhY3QuRE9NLnNwYW4oe2NsYXNzTmFtZTogXCJzcHlcIn0sIHNwaWVzVGV4dCksIFwiLiBcIiwgb2Jlcm9uVGV4dClcbiAgICAgICAgICAgICAgICA6IFJlYWN0LkRPTS5wKG51bGwsIFwiWW91IGRvIG5vdCBzZWUgYW55IFwiLCBvdGhlciwgXCIgc3BpZXMuXCIpXG4gICAgICAgIHZhciBleHRyYUluZm8gPSBSZWFjdC5ET00uZGl2KG51bGwpXG4gICAgICAgIHZhciBkZXNjcmlwdGlvbiA9IFJlYWN0LkRPTS5wKG51bGwpXG5cbiAgICAgICAgdmFyIG5hbWUgPSBSZWFjdC5ET00uc3Bhbih7Y2xhc3NOYW1lOiBcInJlc2lzdGFuY2VcIn0sIFwicmVzaXN0YW5jZVwiKVxuXG4gICAgICAgIGlmIChyb2xlLnNweSAmJiAhcm9sZS5vYmVyb24pIHtcbiAgICAgICAgICAgIG5hbWUgPSBSZWFjdC5ET00uc3BhbihudWxsLCBcImEgXCIsIFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwic3B5XCJ9LCBcInNweVwiKSk7XG4gICAgICAgICAgICBleHRyYUluZm8gPSBzcGllc0Jsb2NrO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyb2xlLnBlcmNpdmFsKSB7XG4gICAgICAgICAgICBuYW1lID0gUmVhY3QuRE9NLnNwYW4oe2NsYXNzTmFtZTogXCJyZXNpc3RhbmNlXCJ9LCBcIlBlcmNpdmFsXCIpXG4gICAgICAgICAgICB2YXIgdGhlTWVybGlucyA9IHJvbGUubWVybGlucztcbiAgICAgICAgICAgIHZhciBtZXJsaW5zVGV4dCA9IHRoZU1lcmxpbnMuam9pbignLCAnKTtcbiAgICAgICAgICAgIHZhciBtZXJsaW5Ob3VuID0gdGhlTWVybGlucy5sZW5ndGggPT0gMSA/ICdNZXJsaW4nIDogJ01lcmxpbnMnO1xuICAgICAgICAgICAgdmFyIG1lcmxpblZlcmIgPSB0aGVNZXJsaW5zLmxlbmd0aCA9PSAxID8gJ2lzJyA6ICdhcmUnO1xuICAgICAgICAgICAgdmFyIG1lcmxpbnNCbG9jayA9IFJlYWN0LkRPTS5wKG51bGwsIFwiVGhlIFwiLCBtZXJsaW5Ob3VuLCBcIiBcIiwgbWVybGluVmVyYiwgXCI6IFwiLCBtZXJsaW5zVGV4dClcbiAgICAgICAgICAgIGV4dHJhSW5mbyA9IG1lcmxpbnNCbG9jaztcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uID0gUmVhY3QuRE9NLnAobnVsbCwgXCJZb3Ugc2VlIFwiLCBSZWFjdC5ET00uc3Bhbih7Y2xhc3NOYW1lOiBcInJlc2lzdGFuY2VcIn0sIFwiTWVybGluXCIpLCBcIiBhbmQgXCIsIFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwic3B5XCJ9LCBcIk1vcmdhbmFcIiksIFwiIGJvdGggYXMgTWVybGluLlwiKVxuICAgICAgICB9XG4gICAgICAgIGlmIChyb2xlLm1lcmxpbikge1xuICAgICAgICAgICAgbmFtZSA9IFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwicmVzaXN0YW5jZVwifSwgXCJNZXJsaW5cIik7XG4gICAgICAgICAgICBleHRyYUluZm8gPSBzcGllc0Jsb2NrO1xuICAgICAgICAgICAgZGVzY3JpcHRpb24gPSBSZWFjdC5ET00ucChudWxsLCBcIklmIHRoZSBzcGllcyBkaXNjb3ZlciB5b3VyIGlkZW50aXR5LCByZXNpc3RhbmNlIGxvc2VzIVwiKVxuICAgICAgICB9XG4gICAgICAgIGlmIChyb2xlLm1vcmRyZWQpIHtcbiAgICAgICAgICAgIG5hbWUgPSBSZWFjdC5ET00uc3Bhbih7Y2xhc3NOYW1lOiBcInNweVwifSwgXCJNb3JkcmVkXCIpXG4gICAgICAgICAgICBkZXNjcmlwdGlvbiA9IFJlYWN0LkRPTS5wKG51bGwsIFwiWW91IGFyZSBpbnZpc2libGUgdG8gXCIsIFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwicmVzaXN0YW5jZVwifSwgXCJNZXJsaW5cIiksIFwiLlwiKVxuICAgICAgICB9XG4gICAgICAgIGlmIChyb2xlLm1vcmdhbmEpIHtcbiAgICAgICAgICAgIG5hbWUgPSBSZWFjdC5ET00uc3Bhbih7Y2xhc3NOYW1lOiBcInNweVwifSwgXCJNb3JnYW5hXCIpXG4gICAgICAgICAgICBkZXNjcmlwdGlvbiA9IFJlYWN0LkRPTS5wKG51bGwsIFwiWW91IGFwcGVhciBhcyBcIiwgUmVhY3QuRE9NLnNwYW4oe2NsYXNzTmFtZTogXCJyZXNpc3RhbmNlXCJ9LCBcIk1lcmxpblwiKSwgXCIgdG8gXCIsIFJlYWN0LkRPTS5zcGFuKHtjbGFzc05hbWU6IFwicmVzaXN0YW5jZVwifSwgXCJQZXJjaXZhbFwiKSwgXCIuXCIpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJvbGUub2Jlcm9uKSB7XG4gICAgICAgICAgICBuYW1lID0gUmVhY3QuRE9NLnNwYW4oe2NsYXNzTmFtZTogXCJzcHlcIn0sIFwiT2Jlcm9uXCIpXG4gICAgICAgICAgICBkZXNjcmlwdGlvbiA9IFJlYWN0LkRPTS5wKG51bGwsIFwiVGhlIG90aGVyIHNwaWVzIGNhbm5vdCBzZWUgeW91LCBhbmQgeW91IGNhbm5vdCBzZWUgdGhlbS5cIilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBSZWFjdC5ET00uZGl2KHtjbGFzc05hbWU6IFwicm9sZS1jYXJkXCJ9LCBcbiAgICAgICAgICAgIFJlYWN0LkRPTS5wKG51bGwsIFwiWW91IGFyZSBcIiwgbmFtZSwgXCIhXCIpLCBcbiAgICAgICAgICAgIGV4dHJhSW5mbywgXG4gICAgICAgICAgICBkZXNjcmlwdGlvblxuICAgICAgICApXG5cbiAgICB9LFxuXG59KTtcblxudmFyIElmID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnSWYnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBjb25kOiBQVC5ib29sLmlzUmVxdWlyZWQsXG4gICAgICAgIGE6IFBULmNvbXBvbmVudC5pc1JlcXVpcmVkLFxuICAgICAgICBiOiBQVC5jb21wb25lbnQuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHRoaXMucHJvcHMuY29uZCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvcHMuYVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvcHMuYlxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbm1vZHVsZS5leHBvcnRzID0gUm9sZUNhcmRcbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgUGxheWVyQ2hpcCA9IHJlcXVpcmUoJy4vcGxheWVyLWNoaXAuanN4JylcbnZhciBQVCA9IFJlYWN0LlByb3BUeXBlc1xuXG52YXIgUm9sZVBsYXllckVudHJ5ID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnUm9sZVBsYXllckVudHJ5JyxcbiAgICBwcm9wVHlwZXM6IHtcbiAgICAgICAgbmFtZTogUFQuc3RyaW5nLmlzUmVxdWlyZWQsXG4gICAgICAgIGNvbmZpcm1lZDogUFQuYm9vbC5pc1JlcXVpcmVkLFxuICAgICAgICBzZWxlY3RlZDogUFQuYm9vbC5pc1JlcXVpcmVkLFxuICAgICAgICBjb250ZW50OiBQVC5jb21wb25lbnQsXG5cbiAgICAgICAgb25DbGlja1Nob3c6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25DbGlja0NvbmZpcm06IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25DbGlja0JhY2s6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS5saSh7a2V5OiB0aGlzLnByb3BzLm5hbWV9LCBcbiAgICAgICAgICAgIFBsYXllckNoaXAoe25hbWU6IHRoaXMucHJvcHMubmFtZX0pLCBcbiAgICAgICAgICAgIHRoaXMucmVuZGVyQnV0dG9uKCksIFxuICAgICAgICAgICAgdGhpcy5wcm9wcy5jb250ZW50XG4gICAgICAgIClcbiAgICB9LFxuXG4gICAgcmVuZGVyQnV0dG9uOiBmdW5jdGlvbigpIHtcblxuICAgICAgICB2YXIgY2xpY2tIYW5kbGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLnByb3BzLm9uQ2xpY2tTaG93KHRoaXMucHJvcHMubmFtZSlcbiAgICAgICAgfS5iaW5kKHRoaXMpO1xuICAgICAgICB2YXIgdGV4dCA9IFwiU2hvdyByb2xlXCI7XG5cbiAgICAgICAgaWYodGhpcy5wcm9wcy5jb25maXJtZWQpIHtcbiAgICAgICAgICAgIGNsaWNrSGFuZGxlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHRoaXMucHJvcHMub25DbGlja0JhY2soKVxuICAgICAgICAgICAgfS5iaW5kKHRoaXMpO1xuICAgICAgICAgICAgdGV4dCA9IFwiSGlkZVwiO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHRoaXMucHJvcHMuc2VsZWN0ZWQpIHtcbiAgICAgICAgICAgIGNsaWNrSGFuZGxlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHRoaXMucHJvcHMub25DbGlja0NvbmZpcm0odGhpcy5wcm9wcy5uYW1lKVxuICAgICAgICAgICAgfS5iaW5kKHRoaXMpO1xuICAgICAgICAgICAgdGV4dCA9IFwiQXJlIHlvdSBcIiArIHRoaXMucHJvcHMubmFtZSArIFwiP1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS5idXR0b24oe29uQ2xpY2s6IGNsaWNrSGFuZGxlcn0sIHRleHQpXG4gICAgfVxuXG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb2xlUGxheWVyRW50cnlcbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgUm9sZVBsYXllckVudHJ5ID0gcmVxdWlyZSgnLi9yb2xlLXBsYXllci1lbnRyeS5qc3gnKVxudmFyIFJvbGVDYXJkID0gcmVxdWlyZSgnLi9yb2xlLWNhcmQuanN4JylcbnZhciBQVCA9IFJlYWN0LlByb3BUeXBlc1xuXG52YXIgUm9sZXNQYWdlID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnUm9sZXNQYWdlJyxcbiAgICBwcm9wVHlwZXM6IHtcbiAgICAgICAgZGlzYWJsZWRSZWFzb246IFBULm9uZU9mKFsndG9vRmV3JywgJ3Rvb01hbnknXSksXG4gICAgICAgIHBsYXllck5hbWVzOiBQVC5hcnJheS5pc1JlcXVpcmVkLFxuICAgICAgICBzZWxlY3RlZFBsYXllcjogUFQuc3RyaW5nLFxuICAgICAgICBzZWxlY3RlZFJvbGU6IFBULm9iamVjdCxcbiAgICAgICAgc2VsZWN0aW9uQ29uZmlybWVkOiBQVC5ib29sLmlzUmVxdWlyZWQsXG4gICAgICAgIG9uQ2xpY2tTaG93OiBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgICAgIG9uQ2xpY2tDb25maXJtOiBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgICAgIG9uQ2xpY2tDYW5jZWw6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25DbGlja09rOiBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgfSxcblxuICAgIHJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICh0aGlzLnByb3BzLmRpc2FibGVkUmVhc29uICE9PSBudWxsKSB7XG4gICAgICAgICAgICB2YXIgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgICAgICB0b29GZXc6IFwiTm90IGVub3VnaCBwbGF5ZXJzLiA6KFwiLFxuICAgICAgICAgICAgICAgIHRvb01hbnk6IFwiVG9vIG1hbnkgcGxheWVycy4gOihcIixcbiAgICAgICAgICAgIH1bdGhpcy5wcm9wcy5kaXNhYmxlZFJlYXNvbl1cbiAgICAgICAgICAgIHJldHVybiBSZWFjdC5ET00ucChudWxsLCBtZXNzYWdlKVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGVsZW1lbnRzID0gdGhpcy5wcm9wcy5wbGF5ZXJOYW1lcy5tYXAoZnVuY3Rpb24obmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVuZGVyRW50cnkoXG4gICAgICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgICAgICB0aGlzLnByb3BzLnNlbGVjdGVkUGxheWVyID09PSBuYW1lLFxuICAgICAgICAgICAgICAgIHRoaXMucHJvcHMuc2VsZWN0aW9uQ29uZmlybWVkKVxuICAgICAgICB9LmJpbmQodGhpcykpXG5cbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS51bCh7Y2xhc3NOYW1lOiBcInBsYXllci1saXN0XCJ9LCBcbiAgICAgICAgICAgIGVsZW1lbnRzXG4gICAgICAgIClcblxuICAgIH0sXG5cbiAgICByZW5kZXJFbnRyeTogZnVuY3Rpb24obmFtZSwgc2VsZWN0ZWQsIGNvbmZpcm1lZCkge1xuXG4gICAgICAgIHZhciBjb250ZW50ID0gbnVsbDtcbiAgICAgICAgaWYgKHNlbGVjdGVkICYmIGNvbmZpcm1lZCkge1xuICAgICAgICAgICAgY29udGVudCA9IFJvbGVDYXJkKHtcbiAgICAgICAgICAgICAgICBwbGF5ZXJOYW1lOiB0aGlzLnByb3BzLnNlbGVjdGVkUGxheWVyLCBcbiAgICAgICAgICAgICAgICByb2xlOiB0aGlzLnByb3BzLnNlbGVjdGVkUm9sZX0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gUm9sZVBsYXllckVudHJ5KHtcbiAgICAgICAgICAgIGtleTogbmFtZSwgXG4gICAgICAgICAgICBuYW1lOiBuYW1lLCBcbiAgICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnQsIFxuICAgICAgICAgICAgc2VsZWN0ZWQ6IHNlbGVjdGVkLCBcbiAgICAgICAgICAgIGNvbmZpcm1lZDogc2VsZWN0ZWQgJiYgY29uZmlybWVkLCBcblxuICAgICAgICAgICAgb25DbGlja1Nob3c6IHRoaXMucHJvcHMub25DbGlja1Nob3csIFxuICAgICAgICAgICAgb25DbGlja0NvbmZpcm06IHRoaXMucHJvcHMub25DbGlja0NvbmZpcm0sIFxuICAgICAgICAgICAgb25DbGlja0JhY2s6IHRoaXMucHJvcHMub25DbGlja0NhbmNlbH0pXG5cbiAgICB9LFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm9sZXNQYWdlXG4iLCIvKiogQGpzeCBSZWFjdC5ET00gKi9cblxudmFyIFBUID0gUmVhY3QuUHJvcFR5cGVzXG52YXIgY3ggPSBSZWFjdC5hZGRvbnMuY2xhc3NTZXRcblxudmFyIFNldHRpbmdzID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnU2V0dGluZ3MnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICAvLyBNYXBwaW5nIG9mIHNldHRpbmdzIHRvIHRoZWlyIHZhbHVlcy5cbiAgICAgICAgc2V0dGluZ3M6IFBULm9iamVjdC5pc1JlcXVpcmVkLFxuICAgICAgICBvbkNoYW5nZVNldHRpbmdzOiBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgfSxcblxuICAgIHJlbmRlcjogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBzZXR0aW5nT3JkZXIgPSBbJ21vcmdhbmEnLCAnbW9yZHJlZCcsICdvYmVyb24nLCAnbWVybGluJywgJ3BlcmNpdmFsJ11cbiAgICAgICAgdmFyIGl0ZW1zID0gc2V0dGluZ09yZGVyLm1hcChmdW5jdGlvbihzZXR0aW5nKSB7XG4gICAgICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmxpKHtrZXk6IHNldHRpbmd9LCBUb2dnbGUoe1xuICAgICAgICAgICAgICAgIHNldHRpbmc6IHNldHRpbmcsIFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLnByb3BzLnNldHRpbmdzW3NldHRpbmddLCBcbiAgICAgICAgICAgICAgICBvbkNoYW5nZTogdGhpcy5vbkNoYW5nZVNldHRpbmd9KSlcbiAgICAgICAgfS5iaW5kKHRoaXMpKVxuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcInNldHRpbmdzXCJ9LCBcbiAgICAgICAgICAgIFJlYWN0LkRPTS5oMihudWxsLCBcIlNwZWNpYWwgUm9sZXNcIiksIFxuICAgICAgICAgICAgUmVhY3QuRE9NLnVsKG51bGwsIGl0ZW1zKVxuICAgICAgICApXG4gICAgfSxcblxuICAgIG9uQ2hhbmdlU2V0dGluZzogZnVuY3Rpb24oc2V0dGluZykge1xuICAgICAgICB2YXIgY2hhbmdlcyA9IHt9XG4gICAgICAgIGNoYW5nZXNbc2V0dGluZ10gPSAhdGhpcy5wcm9wcy5zZXR0aW5nc1tzZXR0aW5nXVxuICAgICAgICB0aGlzLnByb3BzLm9uQ2hhbmdlU2V0dGluZ3MoY2hhbmdlcylcbiAgICB9LFxufSk7XG5cbnZhciBUb2dnbGUgPSBSZWFjdC5jcmVhdGVDbGFzcyh7ZGlzcGxheU5hbWU6ICdUb2dnbGUnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBzZXR0aW5nOiBQVC5zdHJpbmcuaXNSZXF1aXJlZCxcbiAgICAgICAgdmFsdWU6IFBULmJvb2wuaXNSZXF1aXJlZCxcbiAgICAgICAgb25DaGFuZ2U6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS5idXR0b24oe1xuICAgICAgICAgICAgY2xhc3NOYW1lOiBjeCh7XG4gICAgICAgICAgICAgICAgJ3RvZ2dsZSc6IHRydWUsXG4gICAgICAgICAgICAgICAgJ2FjdGl2ZSc6IHRoaXMucHJvcHMudmFsdWUsXG4gICAgICAgICAgICB9KSwgXG4gICAgICAgICAgICBvbkNsaWNrOiB0aGlzLm9uQ2xpY2t9LCBcbiAgICAgICAgICAgIGNhcGl0YWxpemUodGhpcy5wcm9wcy5zZXR0aW5nKVxuICAgICAgICApXG4gICAgfSxcblxuICAgIG9uQ2xpY2s6IGZ1bmN0aW9uKCkge1xuICAgICAgICB0aGlzLnByb3BzLm9uQ2hhbmdlKHRoaXMucHJvcHMuc2V0dGluZylcbiAgICB9LFxufSk7XG5cbmZ1bmN0aW9uIGNhcGl0YWxpemUoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHN0cmluZy5zbGljZSgxKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBTZXR0aW5nc1xuIiwiLyoqIEBqc3ggUmVhY3QuRE9NICovXG5cbnZhciBTZXR1cFBsYXllckxpc3QgPSByZXF1aXJlKCcuL3NldHVwLXBsYXllci1saXN0LmpzeCcpXG52YXIgU2V0dGluZ3MgPSByZXF1aXJlKCcuL3NldHRpbmdzLmpzeCcpXG52YXIgUFQgPSBSZWFjdC5Qcm9wVHlwZXNcblxudmFyIFNldHVwUGFnZSA9IFJlYWN0LmNyZWF0ZUNsYXNzKHtkaXNwbGF5TmFtZTogJ1NldHVwUGFnZScsXG4gICAgcHJvcFR5cGVzOiB7XG4gICAgICAgIHBsYXllck5hbWVzOiBQVC5hcnJheS5pc1JlcXVpcmVkLFxuICAgICAgICAvLyBNYXBwaW5nIG9mIHNldHRpbmdzIHRvIHRoZWlyIHZhbHVlcy5cbiAgICAgICAgc2V0dGluZ3M6IFBULm9iamVjdC5pc1JlcXVpcmVkLFxuICAgICAgICBvbkFkZE5hbWU6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25EZWxldGVOYW1lOiBQVC5mdW5jLmlzUmVxdWlyZWQsXG4gICAgICAgIG9uQ2hhbmdlU2V0dGluZ3M6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICAgICAgb25OZXdSb2xlczogUFQuZnVuYy5pc1JlcXVpcmVkLFxuICAgIH0sXG5cbiAgICByZW5kZXI6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmRpdihudWxsLCBcbiAgICAgICAgICAgIFNldHVwUGxheWVyTGlzdCh7XG4gICAgICAgICAgICAgICAgcGxheWVyTmFtZXM6IHRoaXMucHJvcHMucGxheWVyTmFtZXMsIFxuICAgICAgICAgICAgICAgIG9uQWRkTmFtZTogdGhpcy5wcm9wcy5vbkFkZE5hbWUsIFxuICAgICAgICAgICAgICAgIG9uRGVsZXRlTmFtZTogdGhpcy5wcm9wcy5vbkRlbGV0ZU5hbWV9KSwgXG4gICAgICAgICAgICBTZXR0aW5ncyh7XG4gICAgICAgICAgICAgICAgc2V0dGluZ3M6IHRoaXMucHJvcHMuc2V0dGluZ3MsIFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlU2V0dGluZ3M6IHRoaXMucHJvcHMub25DaGFuZ2VTZXR0aW5nc30pLCBcbiAgICAgICAgICAgIFJlYWN0LkRPTS5idXR0b24oe2NsYXNzTmFtZTogXCJuZXctZ2FtZVwiLCBcbiAgICAgICAgICAgICAgICBvbkNsaWNrOiB0aGlzLnByb3BzLm9uTmV3Um9sZXN9LCBcIk5ldyBHYW1lXCIpXG4gICAgICAgIClcbiAgICB9LFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2V0dXBQYWdlXG4iLCIvKiogQGpzeCBSZWFjdC5ET00gKi9cblxudmFyIE5ld05hbWUgPSByZXF1aXJlKCcuL25ldy1uYW1lLmpzeCcpXG52YXIgUGxheWVyQ2hpcCA9IHJlcXVpcmUoJy4vcGxheWVyLWNoaXAuanN4JylcbnZhciBQVCA9IFJlYWN0LlByb3BUeXBlc1xuXG52YXIgU2V0dXBQbGF5ZXJMaXN0ID0gUmVhY3QuY3JlYXRlQ2xhc3Moe2Rpc3BsYXlOYW1lOiAnU2V0dXBQbGF5ZXJMaXN0JyxcbiAgICBwcm9wVHlwZXM6IHtcbiAgICAgICAgcGxheWVyTmFtZXM6IFBULmFycmF5LmlzUmVxdWlyZWQsXG4gICAgICAgIG9uRGVsZXRlTmFtZTogUFQuZnVuYy5pc1JlcXVpcmVkLFxuICAgICAgICBvbkFkZE5hbWU6IFBULmZ1bmMuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGVsZW1lbnRzID0gdGhpcy5wcm9wcy5wbGF5ZXJOYW1lcy5tYXAoXG4gICAgICAgICAgICB0aGlzLnJlbmRlckVudHJ5KVxuXG4gICAgICAgIHJldHVybiBSZWFjdC5ET00uZGl2KG51bGwsIFJlYWN0LkRPTS5oMihudWxsLCBcIlBsYXllcnNcIiksIFxuICAgICAgICAgICAgUmVhY3QuRE9NLnVsKHtjbGFzc05hbWU6IFwicGxheWVyLWxpc3RcIn0sIFxuICAgICAgICAgICAgICAgIGVsZW1lbnRzLCBcbiAgICAgICAgICAgICAgICBSZWFjdC5ET00ubGkobnVsbCwgXG4gICAgICAgICAgICAgICAgICAgIE5ld05hbWUoe29uQWRkTmFtZTogdGhpcy5wcm9wcy5vbkFkZE5hbWV9KVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgIClcbiAgICAgICAgKVxuICAgIH0sXG5cbiAgICByZW5kZXJFbnRyeTogZnVuY3Rpb24obmFtZSkge1xuICAgICAgICB2YXIgb25DbGljayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdGhpcy5wcm9wcy5vbkRlbGV0ZU5hbWUobmFtZSk7XG4gICAgICAgIH0uYmluZCh0aGlzKTtcblxuICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmxpKHtrZXk6IG5hbWV9LCBcbiAgICAgICAgICAgIFBsYXllckNoaXAoe25hbWU6IG5hbWV9KSwgXG4gICAgICAgICAgICBSZWFjdC5ET00uYnV0dG9uKHtjbGFzc05hbWU6IFwiZGVsZXRlXCIsIFxuICAgICAgICAgICAgICAgIG9uQ2xpY2s6IG9uQ2xpY2t9XG4gICAgICAgICAgICApXG4gICAgICAgIClcbiAgICB9LFxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2V0dXBQbGF5ZXJMaXN0XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHN0b3JlX3Jlc2V0XG5cbmZ1bmN0aW9uIHN0b3JlX3Jlc2V0KHZlcnNpb24pIHtcbiAgICB2YXIgc3RvcmVkID0gc3RvcmUuZ2V0KCdTVE9SRV9EQl9WRVJTSU9OJylcbiAgICBpZiAoc3RvcmVkID09PSB2ZXJzaW9uKSB7XG4gICAgICAgIHJldHVyblxuICAgIH0gZWxzZSB7XG4gICAgICAgIHN0b3JlLmNsZWFyKClcbiAgICAgICAgc3RvcmUuc2V0KCdTVE9SRV9EQl9WRVJTSU9OJywgdmVyc2lvbilcbiAgICB9XG59XG4iLCJ2YXIgQmFja2JvbmVFdmVudHMgPSByZXF1aXJlKFwiYmFja2JvbmUtZXZlbnRzLXN0YW5kYWxvbmVcIik7XG5cbm1vZHVsZS5leHBvcnRzID0gU3RvcmVcblxuZnVuY3Rpb24gU3RvcmUoKSB7XG4gICAgdGhpcy5fZXZlbnRlciA9IEJhY2tib25lRXZlbnRzLm1peGluKHt9KVxuICAgIHRoaXMuX2VtaXRDaGFuZ2VCYXRjaGVyID0gbnVsbFxufVxuXG4vKipcbiAqIFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gZmlyZSBvbiBjaGFuZ2UgZXZlbnRzLlxuICovXG5TdG9yZS5wcm90b3R5cGUub25DaGFuZ2UgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICAgIHRoaXMuX2V2ZW50ZXIub24oJ2NoYW5nZScsIGNhbGxiYWNrKVxufVxuXG4vKipcbiAqIFVucmVnaXN0ZXIgYSBjYWxsYmFjayBwcmV2aW91c2x5IHJlZ2lzdGVyZCB3aXRoIG9uQ2hhbmdlLlxuICovXG5TdG9yZS5wcm90b3R5cGUub2ZmQ2hhbmdlID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgICB0aGlzLl9ldmVudGVyLm9mZignY2hhbmdlJywgY2FsbGJhY2spXG59XG5cbi8qKlxuICogRmlyZSBhIGNoYW5nZSBldmVudCBmb3IgdGhpcyBzdG9yZVxuICogVGhpcyBzaG91bGQgcHJvYmFibHkgb25seSBiZSBjYWxsZWQgYnkgdGhlIHN0b3JlIGl0c2VsZlxuICogYWZ0ZXIgaXQgbXV0YXRlcyBzdGF0ZS5cbiAqXG4gKiBUaGVzZSBhcmUgYmF0Y2hlZCB1c2luZyBzZXRUaW1lb3V0LlxuICogSSBkb24ndCBhY3R1YWxseSBrbm93IGVub3VnaCB0byBrbm93IHdoZXRoZXIgdGhpcyBpcyBhIGdvb2QgaWRlYS5cbiAqIEJ1dCBpdCdzIGZ1biB0byB0aGluayBhYm91dC5cbiAqIFRoaXMgaXMgTk9UIGRvbmUgZm9yIHBlcmZvcm1hbmNlLCBidXQgdG8gb25seSBlbWl0IGNoYW5nZXNcbiAqIHdoZW4gdGhlIHN0b3JlIGhhcyBzZXR0bGVkIGludG8gYSBjb25zaXN0ZW50IHN0YXRlLlxuICovXG5TdG9yZS5wcm90b3R5cGUuZW1pdENoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9lbWl0Q2hhbmdlQmF0Y2hlciA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLl9lbWl0Q2hhbmdlQmF0Y2hlciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB0aGlzLl9ldmVudGVyLnRyaWdnZXIoJ2NoYW5nZScpXG4gICAgICAgICAgICB0aGlzLl9lbWl0Q2hhbmdlQmF0Y2hlciA9IG51bGxcbiAgICAgICAgfS5iaW5kKHRoaXMpLCAxMClcbiAgICB9XG59XG5cbi8qKlxuICogTWl4IGludG8gYW4gb2JqZWN0IHRvIG1ha2UgaXQgYSBzdG9yZS5cbiAqIEV4YW1wbGU6XG4gKiBmdW5jdGlvbiBBd2Vzb21lU3RvcmUoKSB7XG4gKiAgIFN0b3JlLm1peGluKHRoaXMpXG4gKiB9XG4gKi9cblN0b3JlLm1peGluID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIHN0b3JlID0gbmV3IFN0b3JlKClcbiAgICBvYmoub25DaGFuZ2UgPSBzdG9yZS5vbkNoYW5nZS5iaW5kKHN0b3JlKVxuICAgIG9iai5vZmZDaGFuZ2UgPSBzdG9yZS5vZmZDaGFuZ2UuYmluZChzdG9yZSlcbiAgICBvYmouZW1pdENoYW5nZSA9IHN0b3JlLmVtaXRDaGFuZ2UuYmluZChzdG9yZSlcbn1cbiIsIi8qKiBAanN4IFJlYWN0LkRPTSAqL1xuXG52YXIgUFQgPSBSZWFjdC5Qcm9wVHlwZXNcbnZhciBjeCA9IFJlYWN0LmFkZG9ucy5jbGFzc1NldFxuXG52YXIgVGFicyA9IFJlYWN0LmNyZWF0ZUNsYXNzKHtkaXNwbGF5TmFtZTogJ1RhYnMnLFxuICAgIHByb3BUeXBlczoge1xuICAgICAgICBhY3RpdmVUYWI6IFBULnN0cmluZy5pc1JlcXVpcmVkLFxuICAgICAgICBvbkNoYW5nZVRhYjogUFQuZnVuYy5pc1JlcXVpcmVkLFxuICAgICAgICB0YWJzOiBQVC5vYmplY3QuaXNSZXF1aXJlZCxcbiAgICB9LFxuXG4gICAgcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIFJlYWN0LkRPTS5kaXYobnVsbCwgXG4gICAgICAgICAgICBSZWFjdC5ET00ubmF2KG51bGwsIFxuICAgICAgICAgICAgdGhpcy5yZW5kZXJCdXR0b25zKClcbiAgICAgICAgICAgICksIFxuICAgICAgICAgICAgUmVhY3QuRE9NLmRpdih7Y2xhc3NOYW1lOiBcInRhYi1jb250ZW50c1wifSwgXG4gICAgICAgICAgICB0aGlzLnByb3BzLnRhYnNbdGhpcy5wcm9wcy5hY3RpdmVUYWJdLmNvbnRlbnRcbiAgICAgICAgICAgIClcbiAgICAgICAgKVxuICAgIH0sXG5cbiAgICByZW5kZXJCdXR0b25zOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIF8ubWFwKHRoaXMucHJvcHMudGFicywgZnVuY3Rpb24odmFsLCBuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gUmVhY3QuRE9NLmEoe1xuICAgICAgICAgICAgICAgIGNsYXNzTmFtZTogY3goe1xuICAgICAgICAgICAgICAgICAgICAnYWN0aXZlJzogdGhpcy5wcm9wcy5hY3RpdmVUYWIgPT09IG5hbWUsXG4gICAgICAgICAgICAgICAgfSksIFxuICAgICAgICAgICAgICAgIGtleTogbmFtZSwgXG4gICAgICAgICAgICAgICAgJ2RhdGEtbmFtZSc6IG5hbWUsIFxuICAgICAgICAgICAgICAgIG9uQ2xpY2s6IHRoaXMucHJvcHMub25DaGFuZ2VUYWIuYmluZChudWxsLCBuYW1lKX0sIFxuICAgICAgICAgICAgICAgIHZhbC5uYW1lKVxuICAgICAgICB9LmJpbmQodGhpcykpIFxuICAgIH0sXG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBUYWJzXG4iLCJ2YXIgU3RvcmUgPSByZXF1aXJlKCcuL3N0b3JlJylcblxubW9kdWxlLmV4cG9ydHMgPSBVSVN0YXRlXG5cbmZ1bmN0aW9uIFVJU3RhdGUoZGlzcGF0Y2hlcikge1xuICAgIFN0b3JlLm1peGluKHRoaXMpXG5cbiAgICB0aGlzLnRhYiA9ICdzZXR1cCdcbiAgICB0aGlzLnNlbGVjdGVkUGxheWVyID0gbnVsbFxuICAgIHRoaXMuc2VsZWN0aW9uQ29uZmlybWVkID0gZmFsc2VcbiAgICB0aGlzLm1pc3Npb25SZXZlYWxlZCA9IGZhbHNlXG5cbiAgICBkaXNwYXRjaGVyLm9uQWN0aW9uKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAgICAgICAgdmFyIGFjdGlvbnMgPSBVSVN0YXRlLmFjdGlvbnNcbiAgICAgICAgaWYgKF8uaXNGdW5jdGlvbihhY3Rpb25zW3BheWxvYWQuYWN0aW9uXSkpIHtcbiAgICAgICAgICAgIGFjdGlvbnNbcGF5bG9hZC5hY3Rpb25dLmNhbGwodGhpcywgcGF5bG9hZClcbiAgICAgICAgICAgIHRoaXMuc2F2ZSgpXG4gICAgICAgIH1cbiAgICB9LmJpbmQodGhpcykpXG59XG5cbnZhciBQRVJTSVNUX0tFWVMgPSBbJ3RhYicsICdzZWxlY3RlZFBsYXllcicsICdzZWxlY3Rpb25Db25maXJtZWQnLCAnbWlzc2lvblJldmVhbGVkJ11cblxuVUlTdGF0ZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwZXJzaXN0ID0ge31cbiAgICBQRVJTSVNUX0tFWVMuZm9yRWFjaChrZXkgPT4gcGVyc2lzdFtrZXldID0gdGhpc1trZXldKVxuICAgIHN0b3JlLnNldCgnc3RvcmUudWlzdGF0ZScsIHBlcnNpc3QpXG59XG5cblVJU3RhdGUucHJvdG90eXBlLmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGVyc2lzdCA9IHN0b3JlLmdldCgnc3RvcmUudWlzdGF0ZScpXG4gICAgaWYgKHBlcnNpc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBQRVJTSVNUX0tFWVMuZm9yRWFjaChrZXkgPT4gdGhpc1trZXldID0gcGVyc2lzdFtrZXldKVxuICAgIH1cbn1cblxuXG5VSVN0YXRlLmFjdGlvbnMgPSB7fVxuXG5VSVN0YXRlLmFjdGlvbnMuY2hhbmdlVGFiID0gZnVuY3Rpb24oe3RhYn0pIHtcbiAgICB0aGlzLnRhYiA9IHRhYlxuICAgIHRoaXMuc2VsZWN0ZWRQbGF5ZXIgPSBudWxsXG4gICAgdGhpcy5zZWxlY3Rpb25Db25maXJtZWQgPSBmYWxzZVxuICAgIHRoaXMuZW1pdENoYW5nZSgpXG59XG5cblVJU3RhdGUuYWN0aW9ucy5zZWxlY3RQbGF5ZXIgPSBmdW5jdGlvbih7bmFtZX0pIHtcbiAgICB0aGlzLnNlbGVjdGVkUGxheWVyID0gbmFtZVxuICAgIHRoaXMuc2VsZWN0aW9uQ29uZmlybWVkID0gZmFsc2VcbiAgICB0aGlzLmVtaXRDaGFuZ2UoKVxufVxuXG5VSVN0YXRlLmFjdGlvbnMuY29uZmlybVBsYXllciA9IGZ1bmN0aW9uKHtuYW1lfSkge1xuICAgIHRoaXMuc2VsZWN0ZWRQbGF5ZXIgPSBuYW1lXG4gICAgdGhpcy5zZWxlY3Rpb25Db25maXJtZWQgPSB0cnVlXG4gICAgdGhpcy5lbWl0Q2hhbmdlKClcbn1cblxuVUlTdGF0ZS5hY3Rpb25zLmRlc2VsZWN0UGxheWVyID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZWxlY3RlZFBsYXllciA9IG51bGxcbiAgICB0aGlzLnNlbGVjdGlvbkNvbmZpcm1lZCA9IGZhbHNlXG4gICAgdGhpcy5lbWl0Q2hhbmdlKClcbn1cblxuVUlTdGF0ZS5hY3Rpb25zLm1pc3Npb25SZXZlYWwgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1pc3Npb25SZXZlYWxlZCA9IHRydWVcbiAgICB0aGlzLmVtaXRDaGFuZ2UoKVxufVxuXG5VSVN0YXRlLmFjdGlvbnMubWlzc2lvblJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5taXNzaW9uUmV2ZWFsZWQgPSBmYWxzZVxuICAgIHRoaXMuZW1pdENoYW5nZSgpXG59XG5cblVJU3RhdGUuYWN0aW9ucy5uZXdSb2xlcyA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGFiID0gJ3JvbGVzJ1xuICAgIHRoaXMuc2VsZWN0ZWRQbGF5ZXIgPSBudWxsXG4gICAgdGhpcy5zZWxlY3Rpb25Db25maXJtZWQgPSBmYWxzZVxuICAgIHRoaXMuZW1pdENoYW5nZSgpXG59XG4iXX0=
