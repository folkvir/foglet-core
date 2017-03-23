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

const  EventEmitter = require('events');
const uuid = require('uuid/v4');
const _ = require('lodash');

const Socket = require('./../utils/socket.js').Socket;
const SocketPing = require('./../utils/socketping.js');

const Vivaldi = require('vivaldi-coordinates');
const HeightCoordinates = require('vivaldi-coordinates').HeightCoordinates;

/**
 * Implementation of an overlay based a T-man
 * You can change the implementation, of the two threads (ie, active and passive) but there is an implementation
 * Use : run() (by default) or run(activeCallback, passiveCallback)
 */
class TManSpray extends EventEmitter {
	constructor (options) {
		super();

		this.id = uuid();

		this.defaultOptions = {
			p: 5, // max number of peers choosen after ranking
			m: 10, // max number of message sent
			maxBound: 3,
			profile: {
				randomNumber: _.random(0, 100),
				used: false,
				ping: {
					start: 0,
					end: 0,
					value: 0
				}
			},
			neighborhood: {
				webrtc: {
					trickle: false,
					iceServers: []
				},
				protocol: 'overlay-overfog'
			},
			signalOffer: 'new_overfog',
			signalAccept: 'accept_overfog',
			signalOnOffer: 'receive_new_overfog',
			signalOnAccept: 'receive_accept_overfog',
			signalOnReady: 'ready_overfog',
			signalingAdress: 'http://localhost:3000',
			signalRoom: 'joinOverfog',
			signalOnRoom: 'joinedOverfog',
			signalLeave: 'leaveOverfog',
			verbose: true
		};
		this.options = _.merge(this.defaultOptions, options || {});
		this.options.neighborhood.webrtc.iceServers = this.options.rps.iceServers;

		this.source = this.options.overlayOptions.rpsObject ||  this.log(new Error('Need a source as parameter : { source : ... , [, key:val]} '));
		// get unicast protocol, must provide a method send(message, peer)

		// this.log(new Error('Need a unicast protocol as parameter in order to send messages : { unicast : ..., [, key:val] } unicast protocol will listen on the signal "receive"'));
		console.log(this.unicast);
		this.socket = new Socket(this.defaultOptions);
		this.outviewId = this.socket.outviewId;
		this.inviewId = this.socket.inviewId;

		// utils to use with Socket.js
		this.ping = new SocketPing(this.socket);

		// profile of the node
		this.vivaldi = Vivaldi.create(new HeightCoordinates(1, 1, 1));

		// please don't send Class or object that cant be (se/dese)rialized properly
		this.profile = {
			vivaldiPos: this.getVivaldiPos,
			vivaldiDistance: 0,
			rps: {
				inviewId: this.source.inviewId,
				outviewId: this.source.outviewId,
			},
			inviewId: this.inviewId,
			outviewId: this.outviewId
		};
		this.profile = _.merge(this.profile, this.defaultOptions.profile);


		// set of (profile, id)
		this.views = [];
		// when we receive new views we update ours;
		this.on('receive-new-views', views => {
			this.views = views;
			this.cycles++;
			this.emit('update', this.views);
		});
		// this is a random sample of views maintained by the overlay after a rps shuffling
		this.randomSampleViews = [];

		// message buffer
		this.buffer = [];

		this.maxBound = this.defaultOptions.maxBound || 10; // default 10 seconds
		this.factor = 1000; // milliseconds

		this.maxPeers = this.defaultOptions.p; // max number of peers choosen after ranking
		this.maxMessage = this.defaultOptions.m; // max number of message sent

		this.cycles = 0;

		this.socket.join('overfog-tmanspray');

		this.customCallback = (data) => {
			return {
				onInitiate: (offer) => {
					offer.data =  data;
					this.source.sendUnicast(offer, offer.data.id);
				},
				onAccept: (offer) => {
					offer.data =  data;
					this.source.sendUnicast(offer, offer.data.data.id);
				},
				onReady : (id) => {
					// compute the ping
					// this.log('Ready:'+id, this.socket.socket.get(id));
					this.ping.ping(id).then( res => {
						this.profile.ping.value = res;
					});
				}
			};
		};

		this.source.unicast.on('receive', (id, message) => {
			// we init only if the no initialize
			if(message.type && message.type === 'init-system-overfog' && this.views.length <= this.maxPeers) {
				// add the view into our list of views
				let desc = message.descriptor;
				const view = this._transform(message, [ desc ]);
				desc = view[0];
				// we maintain the random sample views
				const index = _.findIndex(this.randomSampleViews, (o) => o.id === desc.id);
				if( index === -1 ) {
					// add
					this.randomSampleViews.push(desc);
				} else {
					// or update
					this.randomSampleViews[index] = desc;
				}
				// we set the first set of views and we connect to them
				this.views = this.selectPeers(this.maxPeers, this.rankingFunction(this.descriptor, this.randomSampleViews));
				console.log('@'+this.id, ': ', this.views);
				// this._connect(this.views);
				this.views.forEach(v => {
					this.socket.connection(null, {
						type: 'init-system-overfog-offer',
						id: v.profile.rps.outviewId,
						socketId: message.socketId,
					}, this.customCallback, 'initiate');
				});

			} else if (message.type && message.data && message.data.type && message.data.type === 'init-system-overfog-offer' && message.type === 'MRequest') {
				message.data.id = id;
				message.data.type = 'init-system-overfog-accept';
				this.socket.connection(null, message, this.customCallback, 'accept');
			} else if (message.type && message.data && message.data.data && message.data.data.type && message.data.data.type === 'init-system-overfog-accept' && message.type === 'MResponse') {
				this.socket.connection(null, message, this.customCallback, 'finalize');

			} else if(message.type && message.type === 'get-random-sample-views') {
				// add the view into our list of views
				let desc = message.descriptor;
				const view = this._transform(message, [ desc ]);
				desc = view[0];
				// we maintain the random sample views
				const index = _.findIndex(this.randomSampleViews, (o) => o.id === desc.id);
				if( index === -1 ) {
					// add
					this.randomSampleViews.push(desc);
				} else {
					// or update
					this.randomSampleViews[index] = desc;
				}
			}
		});


		// Passive Thread
		this.socket.on('receive', message => {
			if (message.message.type && message.message.type === 'connect-to-view') {
				const out = this.socket.socket.get('outview');
				// this.log(out);
				const indexOfFrom = _.findIndex(out, d => d.id === message.message.fromConnect.profile.outviewId),
					indexOfTo = _.findIndex(out, d => d.id === message.message.toConnect.profile.outviewId);
				// now we can established by bridge the connection between the sender and the owner of the view (not us but a neighbor)
				if(indexOfTo !== -1 && indexOfFrom !== -1) {
					const from = out[indexOfFrom];
					const to = out[indexOfTo];
					const res = this.socket.socket.connect(from.id, to.id);
					this.log(`BRIDGE CONNECTION By OVERLAY: ${from && to}`, from, to, ` Status: ${res}`);
					// this.log(this.socket.getNeighbours());
				}
			} else {
				this._passive(this, message.id, message.message);
			}
		});

		// Active thread listening on the event shuffling of the rps
		this.source.on('shuffling', () => {
			this._active(this);
			// we get another random sample of our RPS network
			this.sendRandomSample();
		});
	}


	get getVivaldiPos () {
		return this.vivaldi.getCoordinates();
	}

	/**
	 * Empty function for ternary function
	 * @return {void}
	 */
	_noop () {
		// does nothing else than nothing
	}

	/**
	 *
	 */
	log (...args) {
		if(this.options.verbose) console.log('[OVERLAY] ', args);
	}

	/**
	 * We get a random sample of the network and we put views received into our randomSampleViews list
	 * @return {void}
	 */
	init () {
		const desc = this.getDescriptor();
		let i = 0;
		const peers = this._selectRandomSample();
		while(i < peers.length) {
			this.log('Send: init-system-overfog order to :' + peers[i]);
			this.source.sendUnicast({
				type: 'init-system-overfog',
				socketId: this.id,
				descriptor: desc,
				pingStart: new Date().getTime()
			}, peers[i]);
			i++;
		}
	}

	/**
	 * We send a random sample of the network to neighbors
	 * @return {void}
	 */
	sendRandomSample () {
		const desc = this.getDescriptor();
		let i = 0;
		const peers = this._selectRandomSample();
		while(i < peers.length) {
			this.source.sendUnicast({
				type: 'get-random-sample-views',
				socketId: this.id,
				descriptor: desc,
				pingStart: new Date().getTime()
			}, peers[i]);
			i++;
		}
	}

	/**
	 * Send a message over the socket
	 * @param {string} id id of the sender
	 * @param {object} message the message to send to id over the socket
	 * @return {void}
	 */
	send (id, message) {
		this.log('Message sent : ', message);
		return this.socket.send(id, message);
	}

// pdflatex  bibtex  pdflatex pdflatex
	/* **********************
	 * PRIVATE FUNCTIONS
	 * **********************/

	/**
	 * Connect us to another view by passing through id
	 * @param {string} from id to send the  node on which is a node between fromConnect to toConnect
	 * @param {array} views Views to connect to
	 * @return {void}
	 */
	_connect (from, views) {
		this.log('==========: CONNECT PART :==========');
		let i = 0;
		while(i < views.length && i < this.maxPeers) {
			// is not in our views
			const msg = {
				type: 'connect-to-view',
				toConnect: views[i],
				fromConnect: this.getDescriptor(),
				pingStart: new Date().getTime()
			};
			const res = this.socket.send(from, msg);
			this.log('Connection from: ', from, 'to: ', this.id, ' Message sent:', msg, ' Status', res);
			i++;
		}
	}

	_selectRandomSample () {
		let result = [], i = 0;
		const peers = this.source.getPeers().o;
		// we choose all RPS neighbours
		while(i < peers.length) {
			result.push(peers[i]);
			++i;
		}
		return result;
	}


	/**
	 * Merge by id two arrays with uniq values
	 * @param {array} obj1 ...
	 * @param {array} obj2 ...
	 * @return {array} Uniq merge of obj1 and obj2
	 */
	_merge (obj1, obj2) {
		const concat = _.concat(obj1, obj2);
		return _.uniqBy(concat, 'id');
	}

	/**
	 * Remove all connections not in views
	 * @return {void}
	 */
	_checkConnections () {
		const neigh = this.socket.getNeighbours();
		let i = 0;
		while(i < neigh.outview.length) {
			const index = _.findIndex(this.views, (data) => data.profile.outviewId === neigh.outview[i].id);
			if( index === -1) {
				this.socket.disconnect(neigh.outview[i].id);
			}
			++i;
		}
	}

	/**
	* Return first {maxPeers} of peers choosen by the ranking function
	* @param {integer} maxPeers the number of first Peers to choose
	* @param {object} rank Result of the ranking functions
	* @return {object} the peer choosen
	*/
	selectPeers (maxPeers, rank) {
		let result = [];
		let i = 0;
		const rankSize = rank.length;
		while(result.length < maxPeers && i < rankSize) {
			result.push(rank[i]);
			++i;
		}
		return result;
	}


	get descriptor () {
		return this.getDescriptor();
	}

	getDescriptor () {
		const res = {
			id: this.id,
			profile: this.profile
		};

		// calculated properties
		res.profile.vivaldiPos = this.vivaldi.getCoordinates();

		return res;
	}

	restrictBufferSize (buffer, size) {
		let i = 0;
		let result = [];
		while( result.length < size && i < buffer.length) {
			result.push(buffer[i]);
			++i;
		}
		return result;
	}

	/**
	* ranking function, used to order view as we want, injected parameter : this.views
	* @param {object} obj an object {....}
	* @param {array} array an array of objects [{...},{...},...]
	* @param {boolean} withObj Add obj to array if true to the results
	* @return {array} ranked array
	*/
	rankingFunction (obj, array, withObj = false) {
		if(withObj) array.push(obj);
		let result = array;
		if(array.length > 1) {
			// result = this.sortByPing(obj, array);
			result = this.sortByVivaldiDistance(obj, array);
			// result = this.sortSimple(obj, array);
		}
		return result;
	}

	sortByVivaldiDistance (obj, array) {
		array.forEach(view => {
			let va;
			let posA = view.profile.vivaldiPos;
			if(! (posA instanceof HeightCoordinates && posA)) {
				va = Vivaldi.create(new HeightCoordinates(posA.x, posA.y, posA.h));
			} else {
				va = Vivaldi.create(posA);
			}

			view.profile.vivaldiDistance = Vivaldi.distance(va, this.vivaldi);
		});
		return array.sort( (a, b) => {
			const da = a.profile.vivaldiDistance, db = b.profile.vivaldiDistance;
			if( da > db ) return 1;
			if( db < db ) return -1;
			return 0;
		});
	}

	sortByRandomNumber (obj, array) {
		// Simple implementation, order views by randomNumber, greater to smaller
		return array.sort( (a, b) =>{
			if(a.profile.randomNumber < b.profile.randomNumber) return 1;
			if(a.profile.randomNumber > b.profile.randomNumber) return -1;
			return 0;
		});
	}

	sortByPing (obj, array) {
		return array.sort( (a, b) => {
			if(a.profile.ping.value > b.profile.ping.value) return 1;
			if(a.profile.ping.value < b.profile.ping.value) return 1;
			return 0;
		});
	}

	/**
	 * @private
	 * Deserialize a javascript serialized string
	 * @function _deserialize
	 * @param {string} serializedJavascript - The string to deserialized
	 * @return {object} The deserialized string
	 */
	_deserialize (serializedJavascript) {
		return eval('(' + serializedJavascript + ')');
	}

	/**
	 * Transform and/or compute any calculs
	 * @param {message} message message sent to us
	 * @param {array} views Views to transforms with the message sent to us as second parameter
	 * @return {array} Transformed views
	 */
	_transform (message, views) {
		const pingEnd = new Date().getTime();
		views.forEach(view => {
			// calculate the latency between the peer and us
			view.profile.ping.start = message.pingStart;
			view.profile.ping.end = pingEnd;
			view.profile.ping.value = (pingEnd - message.pingStart) + view.profile.randomNumber;


			const x = view.profile.vivaldiPos.x, y = view.profile.vivaldiPos.y, h = view.profile.vivaldiPos.h;
			let v = Vivaldi.create(new HeightCoordinates(x, y, h));
			// update our location
			Vivaldi.update(view.profile.ping.value, this.vivaldi, v);
			// update its location
			Vivaldi.update(view.profile.ping.value, v, new HeightCoordinates(this.descriptor.profile.vivaldiPos.x, this.descriptor.profile.vivaldiPos.y, this.descriptor.profile.vivaldiPos.h));
			view.profile.vivaldiPos =  { x: v.getCoordinates().x, y: v.getCoordinates().y, h: v.getCoordinates().h };
		});
		return views;
	}

	replaceViews (overlay, views) {
		let o = 0, v = 0;
		let results = [];
		this.log(overlay.views, views);
		while ( v < views.length && o < overlay.views.length) {
			if(!overlay.views[o].used) {
				// we replace the connection so we have to remove the webrtc connection too
				this.log(views[v]);
				results.push(views[v]);
				overlay.socket.disconnect(overlay.views[o].profile.outviewId);
				v++;
			} else {
				results.push(overlay.views[o]);
			}
			o++;
		}
		return results;
	}

	/*
	 * Default implementation of active and passive thread
	 */

	_active (overlay) {
		const descriptor = overlay.getDescriptor(); // my descriptor

		// we rank our views (plus some randomViews) compared to our descriptor a
		const rankedViews = overlay.rankingFunction(descriptor, overlay._merge(overlay.views, overlay.randomSampleViews), false);

		// we select a
		const p = overlay.selectPeers(overlay.maxPeers, rankedViews);

		const buffer = overlay.restrictBufferSize(p, overlay.maxMessage);

		p.forEach(p => {
			this.log(overlay.send(p.profile.outviewId, {
				type: 'onActive',
				buffer,
				pingStart: new Date().getTime()
			}));
		});
	}

	_passive (overlay, id, message) {
		// this.log('=====: passiv callback :=====');
		if (message && message.type && message.buffer) {
			let buffer = [];

			message.buffer = overlay._transform(message, message.buffer);

			if(message.type === 'onActive') {
				const descriptor = overlay.getDescriptor(); // my descriptor
				buffer = overlay._merge(
					[ descriptor ],
					overlay._merge(
							overlay.views,
							overlay.randomSampleViews
					)
				);
				// rank the buffer with each descriptor choosen in p
				// message.buffer.forEach( peer => {
				buffer = overlay.rankingFunction(descriptor, buffer);
				// });
				buffer = overlay.restrictBufferSize(buffer, overlay.maxMessage);

				this.log(overlay.send( id, {
					type: 'onPassive',
					buffer,
					pingStart: new Date().getTime()
				}));
			}

			// Rewrite our views by choose maxPeers ranked views
			const rankedViews = overlay.rankingFunction(overlay.getDescriptor(), overlay._merge(message.buffer, overlay.views));
			// we remove our view from the ranked list
			_.remove(rankedViews, (data) => data.id === overlay.id);

			// now we replace views if only the view is not used.
			overlay.views = overlay.replaceViews(overlay, overlay.selectPeers(
				overlay.maxPeers,
				rankedViews
			));

			this.log('VIEWS SELECTED : ', overlay.views);

			// check if there is only just #views connections
			this._connect(id, overlay.views);
			// overlay._checkConnections();


			// emit to a message that we finish the passive thread
			overlay.emit('receive-new-views', overlay.views);
		}
	}
}

module.exports = { TManSpray };
