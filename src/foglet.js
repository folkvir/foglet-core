/*
MIT License

Copyright (c) 2016 Grall Arnaud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
'use strict';

const EventEmitter = require('events');
const uuid = require('uuid/v4');
const _ = require('lodash');

// FOGLET
const FRegister = require('./flib/fregister.js');
const FInterpreter = require('./flib/finterpreter.js');
const FStore = require('./flib/fstore.js');
const Overlay = require('./overlay/overlay.js');
// Networks
const AdapterSpray = require('./flib/adapter/sprayAdapter.js');
const AdapterFcn = require('./flib/adapter/fcnAdapter.js');

/**
 * Create a Foglet Class in order to use Spray with ease
 * @class Foglet
 * @author Grall Arnaud (folkvir)
 */
class Foglet extends EventEmitter {
	/**
	 * Constructor of Foglet
	 * @constructs Foglet
	 * @param {object} options - it's an object representing options avalaible
	 * @throws {InitConstructException} If options is undefined
	 * @throws {ConstructException} spray, protocol and room must be defined.
	 * @example
	 * var f = new Foglet({
	 * 	spray: new Spray()
	 * 	room: "your-room-name"
	 * })
	 * @returns {void}
	 */
	constructor (options = {}) {
		super();
		this.defaultOptions = {
			webrtc: {
				trickle: true,
				iceServers: []
			},
			signalingAdress: 'http://localhost:3000',
			room: 'default-room',
			protocol: 'foglet-protocol-default',
			verbose: true,
			enableOverlay: false
		};
		this.options = _.merge(this.defaultOptions, options);
		// RPS
		this.options.rps = new (this._chooseRps(this.options.rpsType))(this.options);
		this.inviewId = this.options.rps.inviewId;
		this.outviewId = this.options.rps.outviewId;
		// OVERLAY
		if(this.defaultOptions.enableOverlay) {
			this.options.overlay = new Overlay(this.options.rps, this.defaultOptions);
		}
		// VARIABLES
		this.id = uuid();

		// INTERPRETER
		this.interpreter = new FInterpreter(this);
		// DATA STRUCTURES
		this.registerList = {};
		const self = this;
		this.store = new FStore({
			map : {
				views : function () {
					return self.getNeighbours();
				},
				jobs: {},
			}
		});
		this._flog('Signaling server used : ' + this.options.signalingAdress + ' on the room : ' + this.options.room);
	}

	/**
	 * @private
	 */
	_chooseRps (rpsType) {
		let rps = null;
		switch(rpsType) {
		case 'fcn-wrtc':
			rps = AdapterFcn;
			break;
		case 'spray-wrtc':
			rps = AdapterSpray;
			break;
		default:
			rps = AdapterFcn;
			break;
		}
		return rps;
	}
	/**
	 * Connection method for Foglet to the network specified by protocol and room options
	 * @param {Foglet} foglet Foglet to connect, none by default and the connection is by signaling. Otherwise it uses a direct callback
	 * @param {number} timeout Time before rejecting the promise.
	 * @function connection
	 * @return {Promise} Return a Q.Promise
	 * @example
	 * var f = new Foglet({...});
	 * f.connection().then((response) => console.log).catch(error => console.err);
	 */
	connection (foglet = undefined, timeout = 60000) {
		if(foglet) return this.options.rps.connection(foglet.options.rps, timeout);
		return this.options.rps.connection(undefined, timeout);
	}

	/**
	 * Add a register to the foglet, it will broadcast new values to connected clients.
	 * @function addRegister
	 * @param {String} name - Name of the register
	 * @throws {FRegisterAddException} Throw an exception is not defined or different of the null string
	 * @returns {void}
	 */
	addRegister (name) {
		const spray = this.options.rps;
		const options = {
			name,
			spray,
			protocol: name+'-'+this.options.protocol,
		};
		const reg = new FRegister(options);
		this.registerList[this._fRegisterKey(reg)] = reg;
	}

	/**
	 * Return a register by its name
	 * @function getRegister
	 * @param {String} name - Name of the register
	 * @returns {void}
	 */
	getRegister (name) {
		return this.registerList[name];
	}


	/**
	 * This callback is a parameter of the onRegister function.
	 * @callback callback
	 * @param {object} responseData - Data emits on update
	 */
	/**
	 * Allow to listen emits on a register when updated with a specified name and callback
	 * @function onRegister
	 * @param {String} name - Name of the register
	 * @param {callback} callback - Callback function that handles the response
	 * @returns {void}
	 */
	onRegister (name, callback) {
		this.getRegister(name).on(name + '-receive', callback);
	}

	/**
	 * Allow to listen on Foglet when a broadcasted message arrived
	 * @function onBroadcast
	 * @param {string} signal - The signal we will listen to.
	 * @param {callback} callback - Callback function that handles the response
	 * @returns {void}
	**/
	onBroadcast (signal, callback) {
		this.options.rps.onBroadcast(signal, callback);
	}


	/**
	 * Send a broadcast message to all connected clients.
	 * @function sendBroadcast
	 * @param {object} msg - Message to send.
	 * @returns {void}
	 */
	sendBroadcast (msg) {
		this.options.rps.sendBroadcast(msg);
	}

	/**
	 * This callback is a parameter of the onUnicast function.
	 * @callback callback
	 * @param {string} id - sender id
	 * @param {object} message - the message received
	 */
	/**
	 * onUnicast function allow you to listen on the Unicast Definition protocol, Use only when you want to receive a message from a neighbour
	 * @function onUnicast
	 * @param {callback} callback The callback for the listener
	 * @return {void}
	 */
	onUnicast (callback) {
		this.options.rps.onUnicast(callback);
	}

	/**
	 * Send a message to a specific neighbour (id)
	 * @function sendUnicast
	 * @param {object} message - The message to send
	 * @param {string} id - One of your neighbour's id
	 * @return {boolean} return true if it seems to have sent the message, false otherwise.
	 */
	sendUnicast (message, id) {
		this.options.rps.sendUnicast(message, id);
	}

	/**
	 * Get a random id of my current neighbours
	 * @function getRandomPeerId
	 * @return {string} return an id or a null string otherwise
	 */
	getRandomNeighbourId () {
		const peers = this.options.rps.getNeighbours();
		if(peers.length === 0) {
			return '';
		} else {
			try {
				const random = Math.floor(Math.random() * peers.length);
				const result = peers[random];
				console.log(result);
				return result;
			} catch (e) {
				console.err(e);
				return '';
			}
		}
	}

	/**
	 * Get a list of all available neighbours in the outview
	 * @function getNeighbours
	 * @return {array}  Array of string representing neighbours id, if no neighbours, return an empty array
	 */
	getNeighbours () {
		const peers = this.options.rps.getPeers();
		if(peers.o.length === 0) {
			return [];
		} else {
			return peers.o;
		}
	}

	/**
	 * Get a full list of all available neighbours
	 * @function getNeighbours
	 * @return {array}  Array of string representing neighbours id, if no neighbours, return an empty array
	 */
	getAllNeighbours () {
		const neigh = this.options.rps.getPeers();
		return _.concat(neigh.i, neigh.o);
	}

	/**
	 * Return the name of a Register
	 * @function _fRegisterKey
	 * @private
	 * @param {Register} obj - Register to return the name
	 * @return {string} name - Name of the register in parameter
	 */
	_fRegisterKey (obj) {
		return obj.name;
	}

	/**
	 * Log by prefixing the message;
	 * @function _flog
	 * @private
	 * @param {string} msg Message to log
	 * @returns {void}
	 */
	_flog (...args) {
		if(this.options.verbose) {
			console.log('[FOGLET]:' + ' @' + this.id + ': ', args);
		}
	}
}

module.exports = { Foglet, uuid };
