import wretch from 'wretch'

import {log} from './utils'

import type {User} from './user'
import type { ApiInitializeData, MakeRequest, ConnectionEventData, SessionData } from './types'
import type {Wretcher} from 'wretch'

let externalApi: Wretcher

let token = ''
let start = 0

const DEFAULT_OPTIONS = {
  batchConnectionEvents: false,
  connectionTimeoutValue: 500
}

const REQUEST_TIMEOUT = 10 * 1000

const EXPONENTIAL_BACKOFF = 500
const MAX_EXPONENTIAL_BACKOFF = 60 * 1000

const UNRECOVERABLE_ERRORS = [
  'domain_not_allowed',
  'quota_exceeded',
  'invalid_api_key',
  'app_not_recording',
  'connection_ended',
]

/**
 * An object to map endpoint names to URLs
 * @type {Object}
 */
let urlsMap = {
  'session': '/sessions',
  'events-getusermedia': '/events/get-user-media',
  'events-browser': '/events/browser',
  'connection': '/connection',
  'batch-connection': '/connection/batch',
  'stats': '/stats',
  'track': '/tracks',
  'getPageUrl': '/services/get-url'
}

/**
 * Wrapper class for API communication with the backend service
 */
export class ApiWrapper {
  private apiKey: string
  private apiRoot: string
  private user: User
  private mockRequests: boolean
  private unrecoverable: string[] = UNRECOVERABLE_ERRORS
  /**
   * If we should batch connections events
   * defaults to false and we'll let the server tell us if we should
   */
  private batchConnectionEvents: boolean = DEFAULT_OPTIONS.batchConnectionEvents
  private connectionEvents: Array<[ConnectionEventData, DOMHighResTimeStamp]> = []
  private connectionTimeout: number | null = null

  /**
   * Creates a new ApiWrapper instance and configures the HTTP client
   * @param {Object} options - Configuration options for the API wrapper
   * @param {string} options.apiKey - API key for authentication
   * @param {string} options.apiRoot - Base URL for the API
   * @param {User} options.user - User instance containing user details
   * @param {boolean} options.mockRequests - Whether to mock requests for testing
   */
  constructor (options) {
    this.apiKey = options.apiKey
    this.apiRoot = options.apiRoot

    this.user = options.user

    // debug options
    this.mockRequests = options.mockRequests

    externalApi = wretch()
      // Set the base url
      .url(this.apiRoot)
      .content('text/plain')
      .accept('application/json')
      .options({
        mode: 'cors',
        cache: 'no-cache',
        redirect: 'follow'
      })
      // .catcher(405, this._handleFailedRequest)
  }

  /**
   * Initializes the API session by validating the API key and setting up the session
   * @param {ApiInitializeData} data - Initialization data containing conference details
   * @returns {Promise<Response>} Promise that resolves to the initialization response
   */
  async initialize (data: ApiInitializeData): Promise<Response> {
    let toSend = {...data} as any

    // add the user details
    // used to create the participant object
    toSend.userId = this.user.userId
    toSend.userName = this.user.userName
    toSend.apiKey = this.apiKey

    return this.makeRequest({
      // this is the only hard coded path that should not change
      path: '/initialize',
      // @ts-ignore
      data: toSend
    }).then((response) => {
      if (response) {
        if (response.urls) {
          // update the urls map with the response from server
          urlsMap = {urlsMap, ...response.urls}
        }

        if (typeof response.batchConnectionEvents === 'boolean') {
          this.batchConnectionEvents = response.batchConnectionEvents
        }

        token = response.token
      }

      return response
    })
  }

  /**
   * Retrieves the page URL from the server
   * @param {Object} data - Request data for URL retrieval
   * @returns {Promise<string>} Promise that resolves to the page URL
   */
  async getPageUrl(data) {
    return this.makeRequest({
      path: urlsMap['getPageUrl'],
      data: data
    }).then((response) => {
      return response.url
    })
  }

  /**
   * Creates a new session on the server
   * @param {Object} data - Session creation data
   * @returns {Promise} Promise that resolves when the session is created
   */
  createSession(data) {
    return this.makeRequest({
      path: urlsMap['session'],
      data: data
    }).then((response) => {
      if (response.token) {
        token = response.token
      }
    })
  }

  /**
   * Updates session details on the server
   * @param {Object} data - Session details to update
   * @returns {Promise} Promise that resolves when the session details are updated
   */
  addSessionDetails (data) {
    return this.makeRequest({
      path: urlsMap['session'],
      method: 'put',
      data: data
    })
  }

  /**
   * Sends a page event to the server
   * @param {Object} data - Page event data
   * @returns {Promise} Promise that resolves when the event is sent
   */
  sendPageEvent (data) {
    return this.makeRequest({
      path: urlsMap['events-browser'],
      data: data
    })
  }

  /**
   * Sends a custom event to the server
   * @param {Object} data - Custom event data
   * @returns {Promise} Promise that resolves when the event is sent
   */
  sendCustomEvent (data) {
    return this.makeRequest({
      path: urlsMap['events-browser'],
      data: {
        eventName: 'custom',
        data: data
      }
    })
  }

  /**
   * Sends media device change event to the server
   * @param {Object[]} devices - Array of media devices
   * @returns {Promise} Promise that resolves when the event is sent
   */
  sendMediaDeviceChange (devices) {
    return this.makeRequest({
      path: urlsMap['events-browser'],
      data: {
        eventName: 'mediaDeviceChange',
        devices: devices
      }
    })
  }

  /**
   * Saves getUserMedia event data to the server
   * @param {Object} data - getUserMedia event data
   * @returns {Promise} Promise that resolves when the event is saved
   */
  saveGetUserMediaEvent (data) {
    return this.makeRequest({
      path: urlsMap['events-getusermedia'],
      data: {
        eventName: 'getUserMedia',
        data: data
      }
    })
  }

  /**
   * Sends connection event data, either immediately or batched based on configuration
   * @param {ConnectionEventData} data - Connection event data
   * @returns {Promise|void} Promise if sent immediately, void if batched
   */
  sendConnectionEvent (data: ConnectionEventData) {
    if (this.batchConnectionEvents === false) {
      return this._sendConnectionEvent(data)
    }

    if (this.connectionTimeout !== null) {
      clearTimeout(this.connectionTimeout)
    }

    this.connectionTimeout = window.setTimeout(() => {
      this.sendBatchConnectionEvents()
    }, DEFAULT_OPTIONS.connectionTimeoutValue)

    this.connectionEvents.push([data, Date.now()])
  }

  /**
   * Sends all batched connection events to the server
   * @returns {Promise|void} Promise that resolves when events are sent
   */
  sendBatchConnectionEvents () {
    let events = Array.from(this.connectionEvents)
    this.connectionEvents = []
    clearTimeout(this.connectionTimeout)

    if (events.length === 1) {
      this._handleSingleConnectionEvent(events[0])
    } else {
      this._handleBatchConnectionEvents(events)
    }
  }

  /**
   * Handles sending a single connection event with time delta calculation
   * @private
   * @param {Array} eventData - Tuple containing connection event data and timestamp
   * @returns {Promise} Promise that resolves when the event is sent
   */
  private _handleSingleConnectionEvent ([ev, timestamp]: [ConnectionEventData, DOMHighResTimeStamp]) {
    let now = Date.now()
    let { eventName, peerId, data } = ev

    return this._sendConnectionEvent({
      eventName,
      peerId,
      timeDelta: now - timestamp,
      data
    })
  }

  /**
   * Handles sending multiple connection events as a batch with time delta calculations
   * @private
   * @param {Array} events - Array of tuples containing connection event data and timestamps
   * @returns {Promise} Promise that resolves when the batch is sent
   */
  private _handleBatchConnectionEvents (events: Array<[ConnectionEventData, DOMHighResTimeStamp]>) {
    let now = Date.now()

    let data = events.map((ev) => {
      let [ eventData, timestamp ] = ev
      let { eventName, peerId, data } = eventData

      return {
        eventName,
        peerId,
        timeDelta: now - timestamp,
        data
      }
    })

    return this._sendBatchConnectionEvents(data)
  }

  /**
   * Sends a single connection event to the server
   * @private
   * @param {Object} data - Connection event data
   * @returns {Promise} Promise that resolves when the event is sent
   */
  private _sendConnectionEvent (data) {
    return this.makeRequest({
      path: urlsMap['connection'],
      data: data
    })
  }

  /**
   * Sends batched connection events to the server
   * @private
   * @param {Object[]} data - Array of connection event data
   * @returns {Promise} Promise that resolves when the batch is sent
   */
  private _sendBatchConnectionEvents (data) {
    return this.makeRequest({
      path: urlsMap['batch-connection'],
      data: data
    })
  }

  /**
   * Sends WebRTC statistics data to the server with retry capability
   * @param {Object} data - WebRTC stats data
   * @returns {Promise} Promise that resolves when the stats are sent
   */
  sendWebrtcStats (data) {
    return this.makeRequest({
      path: urlsMap['stats'],
      retry: true,
      data: data
    })
  }

  /**
   * Sends track event data using appropriate HTTP method based on event type
   * @param {Object} data - Track event data
   * @param {string} data.event - Event type that determines HTTP method
   * @returns {Promise} Promise that resolves when the event is sent
   */
  sendTrackEvent (data) {
    const method = data.event === 'ontrack' ? 'post' : 'put'
    return this.makeRequest({
      path: urlsMap['track'],
      method: method,
      retry: true,
      data: data
    })
  }

  /**
   * Sends leave event using keepalive option for reliable delivery during page unload
   * @param {string} event - Leave event name
   * @returns {void}
   */
  sendLeaveEvent (event) {
    let path = urlsMap['events-browser']
    let data = JSON.stringify({
      token: token,
      eventName: event
    })

    if (this.mockRequests) {
      return log('request', Date.now() - start, urlsMap['events-browser'], data)
    }

    externalApi.url(path).options({keepalive: true}).post(data)
  }

  /**
   * Sends event using navigator.sendBeacon for reliable delivery during page unload
   * @param {string} event - Event name to send
   * @returns {void}
   */
  sendBeaconEvent (event) {
    let url = this._createUrl(urlsMap['events-browser'])
    let data = JSON.stringify({
      token: token,
      eventName: event
    })

    if (navigator.sendBeacon) {
      // send a beacon event
      navigator.sendBeacon(url, data)
    }
  }

  /**
   * Sends end call event to the server with retry capability
   * @returns {Promise} Promise that resolves when the event is sent
   */
  sendEndCall () {
    return this.makeRequest({
      path: urlsMap['events-browser'],
      retry: true,
      data: {
        eventName: 'endCall'
      }
    })
  }

  /**
   * Makes HTTP request to the API with error handling and retry logic
   * @private
   * @param {MakeRequest} options - Request configuration options
   * @returns {Promise} Promise that resolves to the response data
   */
  private async makeRequest (options: MakeRequest) {
    // we just need the path, the base url is set at initialization
    let {path, timestamp, data, retry = false} = options

    if (path === '/initialize' && start === 0) {
      start = Date.now()
    }

    log('request', Date.now() - start, path, data)

    // most of the request require a token
    // if we have it, add it to the body
    if (token) {
      data.token = token
    }

    // if we mock requests, resolve immediately
    if (this.mockRequests) {
      return new Promise((resolve) => {
        let response = {}
        if (data.eventName === 'addConnection') {
          response = {
            // @ts-ignore
            peer_id: data.peerId
          }
        }
        // mock a request that takes anywhere between 0 and 1000ms
        setTimeout(() => resolve(response), Math.floor(Math.random() * 1000))
      })
    }

    // if we have a timestamps than this event happened in the past
    // add the delta attribute so the backend knows
    // we might get the timestamp attribute inside data
    // this happens for events that we manually delay sending
    timestamp = timestamp || data.timestamp
    if (timestamp) {
      data.delta = Date.now() - timestamp
    } else {
      // if not, than timestamp this request to be used in case of failure
      timestamp = Date.now()
    }

    let toSend: string
    try {
      toSend = JSON.stringify(data)
    } catch (e) {
      throw new Error('Could not stringify request data')
    }

    // keep the content type as text plain to avoid CORS preflight requests
    let request = externalApi.url(path).content('text/plain')
    let requestToMake

    if (options.method === 'put') {
      requestToMake = request.put(toSend)
    } else {
      requestToMake = request.post(toSend)
    }

    return requestToMake
      .setTimeout(REQUEST_TIMEOUT)
      .json(this._handleResponse)
      .catch((response) => {
        // if we should retry the request
        if (retry) {
          return this._handleFailedRequest({response, timestamp, options})
        }

        throw response
      })
  }

  /**
   * Handles successful API responses by logging and returning the response
   * @private
   * @param {Object} response - API response data
   * @returns {Object} The response data
   */
  private async _handleResponse (response) {
    if (response) {
      log(response)
    }

    return response
  }

  /**
   * Handles failed API requests with exponential backoff retry logic
   * @private
   * @param {Object} arg - Failed request parameters
   * @param {Object} arg.response - Failed response object
   * @param {DOMHighResTimeStamp} arg.timestamp - Original request timestamp
   * @param {MakeRequest} arg.options - Original request options
   * @returns {Promise} Promise that resolves to retry result or rejects with error
   */
  private async _handleFailedRequest (arg) {
    let {response, timestamp, options} = arg
    let {backoff = EXPONENTIAL_BACKOFF} = options
    let body

    try {
      body = JSON.parse(response.message)
      // we have a domain restriction, app paused, invalid api key or over quota, no need for retry
      if (this.unrecoverable.includes(body.error_code)) {
        return Promise.reject(body)
      }
    } catch (e) {}

    // if we got an error, then the user is offline or a timeout
    if (response instanceof Error || response.status > 500) {
      // double the value with each run. starts at 1s
      backoff *= 2

      // don't go over 1 min
      if (backoff > MAX_EXPONENTIAL_BACKOFF) {
        throw new Error('request failed after exponential backoff')
      }

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          options.timestamp = timestamp
          options.backoff = backoff
          this.makeRequest(options).then(resolve).catch(reject)
        }, backoff)
      })
    }

    return Promise.reject(body)
  }

  /**
   * Creates a complete URL by combining the API root with the given path
   * @private
   * @param {string} path - URL path to append to the API root
   * @returns {string} Complete URL
   */
  private _createUrl (path = '/') {
    return `${this.apiRoot}${path}`
  }
}
