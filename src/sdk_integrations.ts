import { EventEmitter } from 'events'

import { CONSTRAINTS } from "./constants";

import type {
    SdkIntegrationInterface,
    WebrtcSDKs,
} from './types/index'

/**
 * Manages integrations with various WebRTC SDKs and SFU servers.
 * Extends EventEmitter to emit 'newConnection' events when peer connections are established.
 */
export default class SdkIntegration extends EventEmitter {
    foundIntegration: boolean = false
    webrtcSDK: WebrtcSDKs

    /**
     * Adds integrations for multiple WebRTC SDKs based on the provided options.
     * @param {SdkIntegrationInterface} options - Configuration object containing SDK-specific options
     * @param {EventEmitter | null} peerConnectionEventEmitter - Event emitter for peer connection events
     * @returns {boolean} True if at least one integration was successfully added
     */
    addIntegration(options: SdkIntegrationInterface, peerConnectionEventEmitter: null | EventEmitter): boolean {

        this.addMediaSoupIntegration(options.mediasoup)
        this.addJanusIntegration(options.janus)
        this.addLivekitIntegration(options.livekit)
        this.addTwilioVideoIntegration(options.twilioVideo)
        this.addVonageIntegration(options.vonage, peerConnectionEventEmitter)
        this.addAgoraIntegration(options.agora, peerConnectionEventEmitter)
        this.addPionIntegration(options.pion, peerConnectionEventEmitter)

        return this.foundIntegration
    }

    /**
     * Integrates with MediaSoup by listening to device transport events.
     * @param {object} options - MediaSoup integration options containing device instance and server details
     */
    addMediaSoupIntegration(options) {
        if (!options) return

        let { device, serverId = 'mediasoup-sfu-server', serverName = 'MediaSoup SFU Server' } = options
        // check if the user sent the right device instance
        if (!device || !device.observer) {
            throw new Error("For integrating with MediaSoup, you need to send an instace of mediasoupClient.Device().")
        }

        serverId = this.checkServerId(serverId)

        serverName = this.checkServerName(serverName)

        this.webrtcSDK = 'mediasoup'

        // listen for new transports
        device.observer.on('newtransport', (transport) => {
            this.emit('newConnection', {
                pc: transport.handler._pc,
                peerId: serverId,
                peerName: serverName,
                isSfu: true,
                remote: true
            })
        })

        this.foundIntegration = true
    }

    /**
     * Integrates with Janus by monitoring plugin WebRTC peer connection creation.
     * @param {object} options - Janus integration options containing plugin instance and server details
     */
    addJanusIntegration(options) {
        if (!options) return

        let { plugin, serverId = 'janus-sfu-server', serverName = 'Janus SFU Server' } = options

        // check if the user sent the right plugin instance
        if (!plugin || typeof plugin.webrtcStuff !== 'object') {
            throw new Error("For integrating with Janus, you need to send an instace of plugin after calling .attach().")
        }

        serverId = this.checkServerId(serverId)

        serverName = this.checkServerName(serverName)

        // if the pc is already attached. should not happen
        if (plugin.webrtcStuff.pc) {
            this.emit('newConnection', {
                pc: plugin.webrtcStuff.pc,
                peerId: serverId,
                peerName: serverName,
                isSfu: true,
                remote: true
            })
        } else {
            let boundEmit = this.emit.bind(this)
            // create a proxy so we can watch when the pc gets created
            plugin.webrtcStuff = new Proxy(plugin.webrtcStuff, {
                set: function (obj, prop, value) {
                    if (prop === 'pc') {
                        boundEmit('newConnection', {
                            pc: value,
                            peerId: serverId,
                            peerName: serverName,
                            isSfu: true,
                            remote: true
                        })
                    }
                    obj[prop] = value;
                    return true;
                }
            })
        }

        this.webrtcSDK = 'janus'
        this.foundIntegration = true
    }

    /**
     * Integrates with LiveKit by listening to room engine transport creation events.
     * @param {object} options - LiveKit integration options containing room instance and server details
     */
    addLivekitIntegration(options) {
        if (!options) return

        let { room, serverId = 'livekit-sfu-server', serverName = 'LiveKit SFU Server' } = options

        // check if the user sent the right room instance
        if (!room || typeof room.engine !== 'object') {
            throw new Error("For integrating with LiveKit, you need to send an instace of the room as soon as creating it.")
        }

        serverId = this.checkServerId(serverId)

        serverName = this.checkServerName(serverName)

        // listen for the transportCreated event
        room.engine.on('transportsCreated', (publiser, subscriber) => {
            this.emit('newConnection', {
                pc: publiser.pc,
                peerId: serverId,
                peerName: serverName,
                isSfu: true,
                remote: true
            })

            this.emit('newConnection', {
                pc: subscriber.pc,
                peerId: serverId,
                peerName: serverName,
                isSfu: true,
                remote: true
            })
        })

        this.webrtcSDK = 'livekit'
        this.foundIntegration = true
    }

    /**
     * Integrates with Twilio Video by accessing existing peer connections from the room's signaling manager.
     * @param {object} options - Twilio Video integration options containing room instance
     */
    addTwilioVideoIntegration (options) {
        if (!options) return

        let { room } = options
        // check if the user sent the right room instance
        if (!room || typeof room._signaling !== 'object') {
            throw new Error("For integrating with Twilio Video SDK, you need to send an instace of the room as soon as you create it.")
        }

        room._signaling._peerConnectionManager._peerConnections.forEach(pcs => {
            this.emit('newConnection', {
                pc: pcs._peerConnection._peerConnection,
                peerId: 'twilio-sfu-server',
                peerName: 'Twilio SFU Server',
                isSfu: true,
                remote: true
            })
        })

        this.webrtcSDK = 'twilioVideo'
        this.foundIntegration = true
    }

    /**
     * Integrates with Vonage by listening to peer connection events from the provided event emitter.
     * @param {boolean} vonage - Flag to enable Vonage integration
     * @param {EventEmitter} peerConnectionEventEmitter - Event emitter that fires 'newRTCPeerconnection' events
     */
    addVonageIntegration(vonage: boolean, peerConnectionEventEmitter: EventEmitter) {
        if (!vonage) return

        if (!peerConnectionEventEmitter) {
            throw new Error("Could not integrate with Vonage. Please make sure you set PeerMetricsOptions.wrapPeerConnection before loading the PeerMetrics script.");            
        }

        peerConnectionEventEmitter.on('newRTCPeerconnection', (pc) => {
            this.emit('newConnection', {
                pc: pc,
                peerId: 'vonage-sfu-server',
                peerName: 'Vonage SFU server',
                isSfu: true,
                remote: true
            })
        })

        this.webrtcSDK = 'vonage'
        this.foundIntegration = true
    }

    /**
     * Integrates with Agora by listening to peer connection events from the provided event emitter.
     * @param {boolean} agora - Flag to enable Agora integration
     * @param {EventEmitter} peerConnectionEventEmitter - Event emitter that fires 'newRTCPeerconnection' events
     */
    addAgoraIntegration(agora: boolean, peerConnectionEventEmitter: EventEmitter) {
        if (!agora) return

        if (!peerConnectionEventEmitter) {
            throw new Error("Could not integrate with agora. Please make sure you set PeerMetricsOptions.wrapPeerConnection before loading the PeerMetrics script.");            
        }

        peerConnectionEventEmitter.on('newRTCPeerconnection', (pc) => {
            this.emit('newConnection', {
                pc: pc,
                peerId: 'agora-sfu-server',
                peerName: 'Agora SFU server',
                isSfu: true,
                remote: true
            })
        })

        this.webrtcSDK = 'agora'
        this.foundIntegration = true
    }

    /**
     * Integrates with Pion by listening to peer connection events from the provided event emitter.
     * @param {boolean | object} options - Pion integration options, can be boolean or object with serverId/serverName
     * @param {EventEmitter} peerConnectionEventEmitter - Event emitter that fires 'newRTCPeerconnection' events
     */
    addPionIntegration (options: SdkIntegrationInterface['pion'], peerConnectionEventEmitter) {
        if (!options) return

        // if the user sent just a boolean, use the default values for server id/name
        if (typeof options === 'boolean') {
            options = {}
        }

        let { serverId = 'pion-sfu-server', serverName = 'Pion SFU server' } = options;

        serverId = this.checkServerId(serverId);
        serverName = this.checkServerName(serverName);

        peerConnectionEventEmitter.on('newRTCPeerconnection', (pc) => {
            this.emit('newConnection', {
                pc: pc,
                peerId: serverId,
                peerName: serverName,
                isSfu: true,
                remote: true
            })
        })

        this.webrtcSDK = 'pion';
        this.foundIntegration = true;
    }

    /**
     * Validates that the serverId is a string and within length constraints.
     * @param {string} serverId - The server ID to validate
     * @returns {string} The validated server ID
     * @throws {Error} If serverId is not a string or exceeds maximum length
     */
    private checkServerId (serverId: string): string {
        if (typeof serverId !== 'string') {
            throw new Error("The serverId must be a string")
        } else if (serverId.length > CONSTRAINTS.peer.idLength) {
            throw new Error(`The serverId must be no longer than ${CONSTRAINTS.peer.idLength} characters.`)
        }

        return serverId
    }

    /**
     * Validates and truncates the serverName if it exceeds length constraints.
     * @param {string} serverName - The server name to validate
     * @returns {string} The validated and potentially truncated server name
     * @throws {Error} If serverName is not a string
     */
    private checkServerName(serverName: string): string {
        if (serverName) {
            if (typeof serverName !== 'string') {
                throw new Error('serverName should be a string')
            }

            // if the name is too long, just snip it
            if (serverName.length > CONSTRAINTS.peer.nameLength) {
                serverName = serverName.slice(CONSTRAINTS.peer.nameLength)
            }
        }

        return serverName
    }
}