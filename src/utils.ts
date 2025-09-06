import { EventEmitter } from 'events'

let debug = false
let realPeerConnection = null

/**
 * Enables or disables debug mode for logging
 * @param {boolean} newValue - Whether to enable debug logging
 */
export function enableDebug (newValue) {
  debug = newValue
}

/**
 * Logs messages to console when debug mode is enabled
 * @param {...any} options - Arguments to pass to console.log
 */
export function log (...options) {
  debug && console.log(...arguments)
}

/**
 * Custom error class for peer metrics related errors
 * @extends Error
 */
export class PeerMetricsError extends Error {
  /** Error code associated with the error */
  code: number
}

/**
 * Wraps the global RTCPeerConnection constructor to emit events when new connections are created
 * @param {object} global - The global object containing RTCPeerConnection
 * @returns {EventEmitter|boolean} EventEmitter that emits 'newRTCPeerconnection' events, or false if RTCPeerConnection is not available
 */
export function wrapPeerConnection(global) {
  if (global.RTCPeerConnection) {
    realPeerConnection = global.RTCPeerConnection
    let peerConnectionEventEmitter = new EventEmitter()

    // this is the ideal way but it causes problems with AdBlocker's wrapper
    // class RTCPeerConnection extends global.RTCPeerConnection {
    //   constructor(parameters) {
    //     super(parameters)
    //     peerConnectionEventEmitter.emit('newRTCPeerconnection', this)
    //   }
    // }
    // global.RTCPeerConnection = RTCPeerConnection

    let WrappedRTCPeerConnection = function (configuration, constraints) {
      let peerconnection = new realPeerConnection(configuration, constraints)
      peerConnectionEventEmitter.emit('newRTCPeerconnection', peerconnection)
      return peerconnection
    }
    WrappedRTCPeerConnection.prototype = realPeerConnection.prototype
    global.RTCPeerConnection = WrappedRTCPeerConnection

    return peerConnectionEventEmitter
  }

  return false
}