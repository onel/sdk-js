import UAParse from 'ua-parser-js'

/**
 * Constructor options for the User class
 */
interface ConstructorOptions {
  userId: string,
  userName?: string
}

/**
 * Gathers information for the current user including platform details, device capabilities, and hardware information
 */
export class User {
  /** Unique identifier for the user */
  public userId: string
  /** Display name for the user */
  public userName: string
  /** Information about the user's device hardware and performance */
  public deviceInfo: object
  /** Platform information including browser and OS details */
  public platform: object = {}
  /** Media track constraints supported by the user's browser */
  public constraints: MediaTrackSupportedConstraints = {}
  /** List of available media devices */
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
   * Gathers and returns comprehensive details about the user's platform and capabilities
   * @returns {Promise<Object>} Promise that resolves to an object containing platform info, constraints, and devices
   */
  async getUserDetails () {
    let platform = await this.gatherPlatformInfo()
    return {...platform}
  }

  /**
   * Collects platform information including browser details, media constraints, devices, and hardware info
   * @returns {Promise<Object>} Promise that resolves to an object with platform, constraints, and devices properties
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
   * Parses the user agent string to extract browser and OS information
   * @returns {Object} Object containing browser name, version, OS, and other user agent details
   */
  getUAdetails () {
    return new UAParse().getResult()
  }

  /**
   * Retrieves the media track constraints supported by the user's browser
   * @returns {MediaTrackSupportedConstraints|Object} Supported constraints object or empty object if not available
   */
  getContraints () {
    if (!window.navigator || !window.navigator.mediaDevices) {
      return {}
    }

    return window.navigator.mediaDevices.getSupportedConstraints()
  }

  /**
   * Gathers device hardware information including battery status, CPU cores, memory, and performance timing
   * @returns {Promise<Object>} Promise that resolves to an object with battery, cores, memory, timing, and navigation properties
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
   * Enumerates and returns available audio/video devices connected to the user's device
   * @returns {Promise<Object[]>} Promise that resolves to an array of device objects with labels, or empty array if enumeration fails
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