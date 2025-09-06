import UAParse from 'ua-parser-js'

/**
 * Configuration options for creating a User instance
 */
interface ConstructorOptions {
  userId: string,
  userName?: string
}

/**
 * We gather the info for the current user here
 */
export class User {
  public userId: string
  public userName: string
  public deviceInfo: object
  public platform: object = {}
  public constraints: MediaTrackSupportedConstraints = {}
  public devices: object[] = []

  /**
   * Creates a new User instance
   * @param {ConstructorOptions} options - Configuration object containing userId and optional userName
   * @throws {Error} Throws an error if userId is not provided
   */
  constructor ({userId, userName}: ConstructorOptions) {
    if (!userId) {
      throw new Error('missing argument userId')
    }

    this.userId = userId
    this.userName = userName
  }

  /**
   * Used initially to gather info about the user's platform and send them
   * @return {Object} Details about the user: userId, userName, platform info, etc
   */
  async getUserDetails () {
    let platform = await this.gatherPlatformInfo()
    return {...platform}
  }

  /**
   * Collects platform information including browser details, constraints, and devices
   * @return {Promise<Object>} Object containing platform, constraints, and devices information
   */
  async gatherPlatformInfo () {
    // browser data
    // version, name, OS
    this.platform = this.getUAdetails()

    this.constraints = this.getContraints()

    this.devices = await this.getDevices()

    this.deviceInfo = await this.getDeviceInfo()

    return {
      platform: this.platform,
      constraints: this.constraints,
      devices: this.devices
    }
  }

  /**
   * Parses user agent string to extract browser and OS information
   * @return {Object} Parsed user agent details including browser, engine, OS, and device info
   */
  getUAdetails () {
    return new UAParse().getResult()
  }

  /**
   * Retrieves supported media constraints from the browser
   * @return {MediaTrackSupportedConstraints|Object} Supported constraints object or empty object if not available
   */
  getContraints () {
    if (!window.navigator || !window.navigator.mediaDevices) {
      return {}
    }

    return window.navigator.mediaDevices.getSupportedConstraints()
  }

  /**
   * Gathers device information including battery status, CPU cores, memory, and performance data
   * @return {Promise<Object>} Object containing battery, cores, memory, timing, and navigation information
   */
  async getDeviceInfo () {
    // @ts-ignore
    let getBattery: any = navigator.getBattery
    let battery

    if (getBattery) {
      try {
        battery = await getBattery()
        battery = {
          charging: battery.charging,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime,
          level: battery.level
        }
      } catch (e) {
        battery = {}
      }
    }

    return {
      battery: battery,
      cores: navigator.hardwareConcurrency,
      // @ts-ignore
      memory: window.performance.memory || {},
      timing: window.performance.timing || {},
      navigation: window.performance.navigation || {}
    }
  }

  /**
   * Get connected audio/video devices connected to this device
   * @return {Promise}
   */
  getDevices () {
    if (!window.navigator.mediaDevices || !window.navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve([])
    }

    return window.navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        let deviceArray = []
        devices.forEach((device) => {
          let dev = device.toJSON()
          if (dev.label) {
            deviceArray.push(dev)
          }
        })

        return deviceArray
      })
      .catch(() => {
        return []
      })
  }
}
